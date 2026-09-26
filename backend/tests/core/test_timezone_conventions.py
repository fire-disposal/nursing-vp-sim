"""时区约定的**源码级**守卫（真库 + 静态扫描）。

两层，缺一不可：
1. **模型层**：`Mapped[datetime...]` 声明的列必须显式写 `DateTime(timezone=True)`。
   只写 `mapped_column(default=_now_utc)` 会被 SQLAlchemy 映射成 `timestamp without time zone`
   —— 这正是 2026-09-26 那批 8 小时偏差的另一半根因（见 docs/ops/timezone-alignment.md）。
2. **库层**：所有表的 timestamp 列都必须是 `timestamp with time zone`（动态扫 information_schema，
   不写死表名 —— 以后新增表若漏了类型，这里立刻红）。
"""

from __future__ import annotations

import re
from pathlib import Path

import sqlalchemy as sa

from core.database import engine as pg_engine

MODELS_DIR = Path(__file__).resolve().parents[2] / "models"


def _declarations_without_tz() -> list[str]:
    """找出声明了 datetime 列却没写 DateTime(timezone=True) 的行（支持跨行声明）。"""
    offenders: list[str] = []
    for path in sorted(MODELS_DIR.glob("*.py")):
        lines = path.read_text(encoding="utf-8").splitlines()
        for i, line in enumerate(lines):
            if "Mapped[datetime" not in line or "mapped_column(" not in line:
                continue
            # 把该声明拼到括号闭合为止（最多 8 行）
            chunk, depth = "", 0
            for j in range(i, min(i + 8, len(lines))):
                chunk += lines[j] + "\n"
                depth += lines[j].count("(") - lines[j].count(")")
                if (depth <= 0 and j > i) or (depth <= 0 and ")" in lines[j]):
                    break
            if "DateTime(timezone=True)" not in chunk:
                offenders.append(f"{path.name}:{i + 1}: {line.strip()[:90]}")
    return offenders


def test_models_declare_timezone_aware_datetimes():
    offenders = _declarations_without_tz()
    assert not offenders, "以下 datetime 列未显式声明 DateTime(timezone=True)（会映射成 naïve）：\n" + "\n".join(
        offenders
    )


def test_no_naive_timestamp_columns_anywhere():
    """动态扫全库：不得存在 timestamp without time zone（新增表漏类型也会被抓到）。"""
    with pg_engine.connect() as conn:
        rows = conn.execute(
            sa.text(
                "SELECT table_name, column_name FROM information_schema.columns "
                "WHERE data_type = 'timestamp without time zone' "
                "AND table_schema = current_schema() ORDER BY table_name, column_name"
            )
        ).all()
    assert not rows, f"仍有 naïve 时间列（会造成 8 小时偏差）：{rows}"


def test_session_timezone_is_pinned_to_shanghai():
    """应用连接必须显式固定时区（不依赖宿主机/compose）。"""
    with pg_engine.connect() as conn:
        tz = conn.execute(sa.text("SHOW timezone")).scalar()
    assert tz == "Asia/Shanghai", f"会话时区为 {tz}"


def test_no_naive_datetime_construction_in_backend():
    """源码级：不得出现 `datetime.now()` / `utcnow()`（会写出墙钟语义）。"""
    backend = Path(__file__).resolve().parents[2]
    pattern = re.compile(r"datetime\.now\(\)|\.utcnow\(\)")
    offenders: list[str] = []
    for root in ("modules", "core", "infra", "models"):
        for path in (backend / root).rglob("*.py"):
            for lineno, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
                if pattern.search(line):
                    offenders.append(f"{path.relative_to(backend)}:{lineno}: {line.strip()[:80]}")
    assert not offenders, "发现 naïve 时间构造：\n" + "\n".join(offenders)
