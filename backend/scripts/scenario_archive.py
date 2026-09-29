"""旧机制会话的归档与封存（docs/23 §9）：**先 dry-run 看数量与差异，再在维护窗口 --apply**。

    cd backend && uv run python -m scripts.scenario_archive --dry-run --expect-db NAME
    cd backend && uv run python -m scripts.scenario_archive --apply   --expect-db NAME [--legacy PATH]
    cd backend && uv run python -m scripts.scenario_archive --verify  --expect-db NAME

- `--dry-run`（默认）：打印待归档数量、活动会话数、事件尾序号、报告有无；**不写任何数据**。
- `--apply`：为每个尚无归档的会话写一份不可变归档（原始事件 + 修订 + 视图 + 原报告），
  然后把仍在 `active` 的旧局封存为 `abandoned`（`meta.abandoned_reason=mechanism_cutover`）
  ——**不补成学生主动完成**。加 `--archive-only` 可只归档不封存。
- `--verify`：回退边界上的校验（归档数量/身份/事件尾序号/报告标记）。
- `--legacy PATH`：用旧实现预先导出的投影包（`scripts/scenario_archive_export.py` 在**旧版本**上运行得到）。

**绝不**由应用启动自动封存活动会话；`--expect-db` 用来在生产窗口防误操作。
"""

from __future__ import annotations

import argparse
import re

from sqlalchemy import select

from core.config import DATABASE_URL
from core.database import SessionLocal
from core.unit_of_work import unit_of_work
from models.scenario_training import StPackRevision, StSession
from modules.scenario_training import pack_loader
from modules.scenario_training.runtime import archive as archive_mod
from modules.scenario_training.runtime.archive import CUTOVER_REASON


def _ended_reason(session) -> str:
    """归档里的结束原因：优先新形状的 `outcome.status`，旧报告退化为 lost/completed。"""
    report = session.report if isinstance(session.report, dict) else None
    if not report:
        return ""
    outcome = report.get("outcome") or {}
    if outcome.get("status"):
        return str(outcome["status"])
    if report.get("lost"):
        return "lost"
    return str(report.get("status") or "completed")


def _guard(expected: str) -> bool:
    name = re.search(r"/([\w]+)(?:\?|$)", DATABASE_URL)
    actual = name.group(1) if name else "?"
    if expected and actual != expected:
        print(f"拒绝运行：DATABASE_URL 指向 {actual}，期望 {expected}")
        return False
    print(f"[archive] 目标库：{actual}")
    return True


def _dry_run(db) -> int:
    plan = archive_mod.plan(db)
    counts = plan["counts"]
    print(
        f"会话总数 {counts['total']}｜已归档 {counts['archived']}｜"
        f"待归档 {counts['pending']}（其中仍 active 的 {counts['active']}）｜带报告的 {counts['reports']}"
    )
    for item in plan["pending"][:40]:
        print(
            f"  · session {item['session_id']}｜{item['pack_key']}@rev{item['pack_revision_id']}｜"
            f"{item['status']}｜事件 {item['events']}｜尾序号 {item['tail_seq']}｜"
            f"报告 {'有' if item['has_report'] else '无'}"
        )
    if counts["pending"] > 40:
        print(f"  … 其余 {counts['pending'] - 40} 条省略")
    print("\n（dry-run：未写任何数据。加 --apply 执行归档。）")
    return 0


def _apply(db, *, legacy_path: str, session_id: int, limit: int, archive_only: bool) -> int:
    legacy = archive_mod.load_legacy_bundle(legacy_path) if legacy_path else {}
    if legacy:
        print(f"[archive] 使用旧实现导出的投影包：{len(legacy)} 个会话（projection_source=legacy_export）")
    sessions = db.execute(select(StSession).order_by(StSession.id)).scalars().all()
    if session_id:
        sessions = [row for row in sessions if row.id == session_id]
    if limit:
        sessions = sessions[:limit]
    done = 0
    for session in sessions:
        revision_row = db.execute(
            select(StPackRevision).where(StPackRevision.id == session.pack_revision_id)
        ).scalar_one_or_none()
        if revision_row is None:
            print(f"  ✗ session {session.id}: 修订 {session.pack_revision_id} 不存在，跳过")
            continue
        with unit_of_work(db, conflict_detail=f"归档会话失败：{session.id}"):
            pack = pack_loader.load_revision(db, session.pack_revision_id)
            row = archive_mod.archive_session(
                db,
                session,
                pack,
                pack_revision=dict(revision_row.content or {}),
                legacy=legacy.get(session.id),
                ended_reason=_ended_reason(session),
                note="docs/23 §9 cutover",
            )
        if row is not None:
            done += 1
    sealed = 0
    if not archive_only:
        with unit_of_work(db, conflict_detail="封存旧活动局失败"):
            sealed = archive_mod.seal_active_sessions(db, reason=CUTOVER_REASON)
    print(f"归档 {done} 份；封存活动旧局 {sealed} 个（reason={CUTOVER_REASON}）")
    result = archive_mod.verify(db)
    print(f"校验：已归档 {result['archived']}，抽查 {result['checked']}，问题 {len(result['problems'])}")
    for problem in result["problems"][:10]:
        print(f"  ✗ {problem}")
    return 1 if result["problems"] else 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="情境旧会话归档 / 封存 / 校验")
    parser.add_argument("--dry-run", action="store_true", help="只打印（默认）")
    parser.add_argument("--apply", action="store_true", help="写归档；默认同时封存活动旧局")
    parser.add_argument("--archive-only", action="store_true", help="只归档，不封存活动旧局")
    parser.add_argument("--verify", action="store_true", help="校验已有归档与原始事件的一致性")
    parser.add_argument("--legacy", default="", help="旧实现导出的投影包 JSON 路径")
    parser.add_argument("--session-id", type=int, default=0, help="只处理某一个会话")
    parser.add_argument("--limit", type=int, default=0, help="最多处理多少个会话")
    parser.add_argument("--expect-db", default="", help="库名不符就拒绝运行")
    args = parser.parse_args(argv)

    if not _guard(args.expect_db):
        return 2
    db = SessionLocal()
    try:
        if args.verify:
            result = archive_mod.verify(db, limit=args.limit)
            print(f"已归档 {result['archived']} 份，抽查 {result['checked']} 份，问题 {len(result['problems'])} 处")
            for problem in result["problems"][:20]:
                print(f"  ✗ {problem}")
            return 1 if result["problems"] else 0
        if not args.apply:
            return _dry_run(db)
        return _apply(
            db,
            legacy_path=args.legacy,
            session_id=args.session_id,
            limit=args.limit,
            archive_only=args.archive_only,
        )
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
