"""``runtime_state`` 写入契约（docs/16 §四「一个事实，一个 owner」）。

回归目标（tech-debt audit PIP-15）：对话/评分/终结三条写路径此前都是「读已加载实例 →
整列回写」，而回合的事务 A 与 LLM 调用之间隔了几十秒 —— 期间工具命令写入的
``exam_results`` 会被随后的整列回写静默抹掉（学生的查体结果消失）。

契约（``modules/training/session/state.patch_runtime_state``）：行锁 + 重读 + 只改
自己拥有的键。本文件守住四条不变式：

  1. 写入自己的键 → 其余键原样保留（工具结果不因对话/评分写入而丢失）；
  2. 以**数据库当前值**为基准（``populate_existing``），不用会话里过期的实例值；
  3. 覆盖整键而非深合并（``message_correction`` 这类整体状态语义固定）；
  4. ``remove`` 只删自己的键。

用 SQLite 上复制一份元数据（JSONB → JSON）跑真实 ORM 路径（与 ``test_case_lifecycle``
同一手法）。
"""

from __future__ import annotations

import json
from datetime import UTC, datetime
from types import SimpleNamespace

import pytest
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Session

from core.exceptions import NotFoundError
from models import Assignment, Case, CaseRevision, Class, Message, Role, TrainingRecord, User
from models.school import legacy_grades_table
from modules.training.pipeline.context import (
    STATE_CORRECTION_TARGET,
    STATE_DONE_PAYLOAD,
    PipelineContext,
)
from modules.training.pipeline.middleware.persister import _persist_correction
from modules.training.session.finalize import (
    END_ORIGIN_PATIENT_WALKOUT,
    END_ORIGIN_USER,
    is_patient_walkout_ended,
    mark_patient_walkout,
    mark_terminal_reason,
    terminal_reason,
)
from modules.training.session.state import patch_runtime_state

#: TrainingRecord 的外键目标必须一起复制（SQLAlchemy 解析 FK 需要表在同一 MetaData 里）
_SOURCE_TABLES = [
    legacy_grades_table,
    Message.__table__,
    Role.__table__,
    User.__table__,
    Class.__table__,
    Case.__table__,
    CaseRevision.__table__,
    Assignment.__table__,
    TrainingRecord.__table__,
]


def _sqlite_metadata() -> sa.MetaData:
    """SQLite 渲染不了 JSONB —— 复制元数据并把 JSONB 降级为 JSON（表名/列名不变）。"""
    meta = sa.MetaData()
    for table in _SOURCE_TABLES:
        table.to_metadata(meta)
    for table in meta.tables.values():
        for column in table.columns:
            if not isinstance(column.type, JSONB):
                continue
            column.type = sa.JSON()
            if column.server_default is not None and "::jsonb" in str(column.server_default.arg):
                column.server_default.arg = sa.text(str(column.server_default.arg).replace("::jsonb", ""))
    return meta


@pytest.fixture
def db():
    engine = sa.create_engine("sqlite://")
    _sqlite_metadata().create_all(engine)
    with Session(engine) as session:
        yield session


def _record(db: Session, state: dict | None = None) -> TrainingRecord:
    """最小可落库的训练记录（工具/对话写入都发生在这张表上）。"""
    role = Role(name="student", display_name="学生", is_system=True)
    db.add(role)
    db.flush()
    user = User(username="contract-student", password_hash="x", display_name="学生", role_id=role.id)
    db.add(user)
    case = Case(name="契约病例", description="", difficulty=1, time_limit_minutes=30)
    db.add(case)
    db.flush()
    record = TrainingRecord(user_id=user.id, case_id=case.id, status="in_progress", runtime_state=state or {})
    db.add(record)
    db.flush()
    return record


_EXAM_RESULTS = [{"type": "temp", "label": "体温", "value": "38.9", "unit": "°C"}]
_SCENE = {"vitals": {"temp": 38.9}, "environment": {"type": "ward"}}


def test_patch_keeps_keys_owned_by_other_writers(db):
    """写入 message_correction 不得动工具写入的 exam_results / scene。"""
    record = _record(db, {"exam_results": _EXAM_RESULTS, "scene": _SCENE})

    merged = patch_runtime_state(db, record.id, {"message_correction": {"used": 1, "limit": 3}})

    assert merged["exam_results"] == _EXAM_RESULTS
    assert merged["scene"] == _SCENE
    assert merged["message_correction"] == {"used": 1, "limit": 3}
    # 落库值一致（不是只在内存里对）
    stored = db.execute(sa.select(TrainingRecord.runtime_state).where(TrainingRecord.id == record.id)).scalar()
    assert stored == merged


def test_patch_reads_current_db_state_not_stale_instance(db):
    """会话里过期的实例值不得作为写入基准（PIP-15 的核心缺陷）。"""
    record = _record(db, {"scene": _SCENE})
    stale = dict(record.runtime_state)  # 模拟几十秒前在事务 A 时读到的值

    # 另一条写路径（工具命令）在此期间提交了查体结果
    db.execute(
        sa.text("UPDATE training_records SET runtime_state = :rs WHERE id = :id"),
        {"rs": json.dumps({**stale, "exam_results": _EXAM_RESULTS}), "id": record.id},
    )

    merged = patch_runtime_state(db, record.id, {"message_correction": {"used": 1, "limit": 3}})

    assert merged["exam_results"] == _EXAM_RESULTS, "过期实例整列回写抹掉了工具写入"
    assert merged["scene"] == _SCENE


def test_patch_builder_sees_locked_current_state(db):
    """回调式 patch 在锁内拿到当前 state（修正计数要基于现值递增）。"""
    record = _record(db, {"message_correction": {"used": 2, "limit": 3}, "exam_results": _EXAM_RESULTS})

    def _next(current: dict) -> dict:
        state = current.get("message_correction") or {}
        return {"message_correction": {**state, "used": int(state.get("used") or 0) + 1}}

    merged = patch_runtime_state(db, record.id, _next)

    assert merged["message_correction"] == {"used": 3, "limit": 3}
    assert merged["exam_results"] == _EXAM_RESULTS


def test_patch_replaces_whole_key_and_removes_own_key(db):
    """整键覆盖（非深合并）；remove 只删自己的键。"""
    record = _record(
        db,
        {
            "force_rescore_snapshot": {"score": 88},
            "message_correction": {"used": 1, "limit": 3, "history": [{"a": 1}]},
            "exam_results": _EXAM_RESULTS,
        },
    )

    merged = patch_runtime_state(db, record.id, {"message_correction": {"used": 2, "limit": 3}})
    assert merged["message_correction"] == {"used": 2, "limit": 3}, "同键必须整体替换，不留旧子键"

    merged = patch_runtime_state(db, record.id, remove=["force_rescore_snapshot"])
    assert "force_rescore_snapshot" not in merged
    assert merged["exam_results"] == _EXAM_RESULTS


def test_patch_missing_record_raises(db):
    with pytest.raises(NotFoundError):
        patch_runtime_state(db, 999_999, {"terminal": {"reason": "user_end"}})


def test_walkout_and_terminal_markers_keep_activity_state(db):
    """会话终结标记（走人 + 结束原因）与查体结果共存，且读侧仍能判定。"""
    record = _record(db, {"exam_results": _EXAM_RESULTS, "scene": _SCENE})
    at = datetime.now(UTC)

    mark_patient_walkout(db, record, at=at)
    mark_terminal_reason(db, record, reason=END_ORIGIN_PATIENT_WALKOUT, at=at)

    stored = db.execute(sa.select(TrainingRecord.runtime_state).where(TrainingRecord.id == record.id)).scalar()
    assert stored["exam_results"] == _EXAM_RESULTS
    assert stored["scene"] == _SCENE
    assert is_patient_walkout_ended(record)
    assert terminal_reason(record) == END_ORIGIN_PATIENT_WALKOUT

    # 换一个读侧 session（新请求）后仍然一致
    db.expire_all()
    mark_terminal_reason(db, record, reason=END_ORIGIN_USER, at=at)
    assert terminal_reason(record) == END_ORIGIN_USER
    assert (
        db.execute(sa.select(TrainingRecord.runtime_state).where(TrainingRecord.id == record.id)).scalar()[
            "exam_results"
        ]
        == _EXAM_RESULTS
    )


# ── 对话修正路径（persister，本次改动的直接受害者） ──────────────────────────


def test_correction_preserves_activity_state_written_during_the_turn(db):
    """修正回合落库时不得抹掉本轮工具写入（PIP-15 的对话侧现场）。

    场景：事务 A 读出 runtime_state（此时还没有查体结果）→ LLM 生成期间学生做了查体
    （工具命令提交 exam_results）→ 事务 B 写修正计数。旧实现用事务 A 的过期实例整列
    回写，查体结果消失；契约实现以库内现值合并自己的键。
    """
    record = _record(db, {"scene": _SCENE})
    old_student = Message(record_id=record.id, role="student", content="我头痛")
    old_patient = Message(record_id=record.id, role="patient", content="多久了？")
    db.add_all([old_student, old_patient])
    db.flush()
    stale = dict(record.runtime_state)  # 事务 A 读到的值（尚无 exam_results）

    # 本轮 LLM 期间的 Activity command 落库
    db.execute(
        sa.text("UPDATE training_records SET runtime_state = :rs WHERE id = :id"),
        {"rs": json.dumps({**stale, "exam_results": _EXAM_RESULTS}), "id": record.id},
    )

    ctx = PipelineContext(
        record=record,
        case_data={},
        current_user=record.user,  # type: ignore[arg-type]
        db=db,
        app_state=SimpleNamespace(initiative_cache=None),
        student_input="我这两天头痛得厉害",
        llm_reply="是一直痛还是阵发？",
        messages=[],
    )
    ctx.state[STATE_CORRECTION_TARGET] = {"student": old_student, "patient": old_patient}

    _persist_correction(ctx)

    stored = db.execute(sa.select(TrainingRecord.runtime_state).where(TrainingRecord.id == record.id)).scalar()
    assert stored["exam_results"] == _EXAM_RESULTS, "修正回合抹掉了本轮的查体结果"
    assert stored["scene"] == _SCENE
    assert stored["message_correction"]["used"] == 1
    # 旧的一对被替换成新的一对（修正语义不变）；按内容断言（SQLite 会复用被删行的 id）
    rows = db.execute(sa.select(Message.role, Message.content).where(Message.record_id == record.id)).all()
    assert [(role, content) for role, content in rows] == [
        ("student", "我这两天头痛得厉害"),
        ("patient", "是一直痛还是阵发？"),
    ]
    assert ctx.state[STATE_DONE_PAYLOAD]["corrections_remaining"] == 2
