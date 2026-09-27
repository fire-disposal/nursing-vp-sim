"""再练习目标解析（W5）：服务端是唯一解析者，且不得成为绕过病例门禁的入口。

固定三条判据（reviewer 在批次复核中指出同例纠正曾漏掉 `Case.is_open` 门禁）：

1. 病例已关闭 → 同例纠正与迁移都不可用（与 ``POST /start`` 同一门禁）；
2. 无家族声明 → 迁移不可用且**不生成假入口**（`practice_options` 带原因）；
3. 家族齐备 → 同例指向自身病例、迁移指向同族另一角色，`start-practice` 解析结果即目标。

真库（PG + savepoint 隔离）。本模块自建 `autoflush=False` 的会话语义与生产一致。
"""

from __future__ import annotations

from datetime import UTC, datetime

import pytest
from sqlalchemy.orm import Session

from core.database import Base
from core.database import engine as pg_engine
from models import Case, Role, TrainingRecord, User
from modules.training.practice import (
    PRACTICE_KIND_REMEDIATION,
    PRACTICE_KIND_TRANSFER,
    REASON_CASE_NOT_OPEN,
    REASON_NO_COUNTERPART,
    REASON_NO_FAMILY,
    PracticeTargetUnavailable,
    practice_options,
    resolve_practice_target,
)

_TABLES = [Role.__table__, User.__table__, Case.__table__, TrainingRecord.__table__]


def _fake_current_revision(db, case):
    """revision 解析在本文件被注入（生产由 `modules.cases.revisions` 提供）。

    这里要测的是**族内目标解析与门禁顺序**，不是发布/revision 机制；用替身可避免把
    "病例必须已发布"这类无关前置拖进用例。
    """
    from types import SimpleNamespace

    return SimpleNamespace(id=case.id, content=case.case_data, revision_no=1)


_FAMILY = "pytest-family"
_PRACTICE_ID = "k1"
_TRANSFER_ID = "k2"


def _case_payload(*, role: str, family: str, name: str) -> dict:
    return {
        "name": name,
        "chief_complaint": "头晕",
        "required_inquiries": ["起病时间"],
        "activities": {"nursing_record": {"config": {"adpie": ["subjective"]}}},
        "blueprint": {
            "learning_objectives": ["能针对回答继续追问"],
            "clues": [{"id": _PRACTICE_ID, "label": "起病线索", "source": "inquiry", "significance": "决定追问方向"}],
            "family_id": family,
            "variant_role": role,
            "transfer_of": name if role == "transfer" else "",
        },
    }


@pytest.fixture
def db():
    with pg_engine.connect() as conn:
        outer = conn.begin()
        Base.metadata.create_all(pg_engine, tables=_TABLES)
        session = Session(bind=conn, join_transaction_mode="create_savepoint", autoflush=False)
        try:
            yield session
        finally:
            session.close()
            outer.rollback()


def _user(db) -> User:
    role = db.query(Role).filter(Role.name == "student").first() or Role(name="student", display_name="学生")
    db.add(role)
    db.flush()
    stamp = datetime.now(UTC).timestamp()
    user = User(username=f"practice-{stamp}", password_hash="x", display_name="学生", role_id=role.id)
    db.add(user)
    db.flush()
    return user


def _case(db, *, name: str, open_: bool = True, family: str = _FAMILY, role: str = "practice") -> Case:
    case = Case(name=name, description="", difficulty=1, time_limit_minutes=30, is_open=open_)
    case.case_data = _case_payload(role=role, family=family, name=name)
    db.add(case)
    db.flush()
    return case


def _record(db, user: User, case: Case) -> TrainingRecord:
    record = TrainingRecord(
        user_id=user.id,
        case_id=case.id,
        status="completed",
        case_snapshot=case.case_data,
    )
    db.add(record)
    db.flush()
    return record


def test_closed_case_blocks_remediation(db):
    """同例纠正不能绕过"病例已关闭"（与 /start 同一门禁）。"""
    user = _user(db)
    case = _case(db, name="已关闭的练习病例", open_=False)
    record = _record(db, user, case)

    with pytest.raises(PracticeTargetUnavailable) as excinfo:
        resolve_practice_target(
            db, source=record, kind=PRACTICE_KIND_REMEDIATION, require_current_revision=_fake_current_revision
        )

    assert excinfo.value.reason == REASON_CASE_NOT_OPEN


def test_transfer_unavailable_without_family_declaration(db):
    """无家族声明 → 迁移不可用，且入口给出机器可读原因（不生成假入口）。"""
    user = _user(db)
    case = _case(db, name="无家族练习病例", family="")
    case.case_data = {k: v for k, v in case.case_data.items() if k != "blueprint"}
    record = _record(db, user, case)

    options = practice_options(db, source=record, require_current_revision=_fake_current_revision)

    assert options[PRACTICE_KIND_TRANSFER]["available"] is False
    assert options[PRACTICE_KIND_TRANSFER]["reason"] == REASON_NO_FAMILY
    assert options[PRACTICE_KIND_REMEDIATION]["available"] is True


def test_family_pair_resolves_both_directions(db):
    """练习病例 → 迁移变式；迁移变式 → 回到练习病例。"""
    user = _user(db)
    practice = _case(db, name="家族练习病例")
    transfer = _case(db, name="家族练习病例·迁移变式", role="transfer")
    practice_record = _record(db, user, practice)
    _ = transfer

    # 注意：Case 需要 is_open 且发布态才进入候选池 —— 候选查询按 status=published 过滤
    practice.status = "published"
    transfer.status = "published"
    db.flush()

    target = resolve_practice_target(
        db, source=practice_record, kind=PRACTICE_KIND_TRANSFER, require_current_revision=_fake_current_revision
    )
    assert target.case.id == transfer.id
    assert target.kind == PRACTICE_KIND_TRANSFER

    transfer_record = _record(db, user, transfer)
    back = resolve_practice_target(
        db, source=transfer_record, kind=PRACTICE_KIND_TRANSFER, require_current_revision=_fake_current_revision
    )
    assert back.case.id == practice.id


def test_transfer_without_counterpart_reports_reason(db):
    """家族里没有另一角色时，迁移入口报 no_counterpart_available（而不是 500 或假成功）。"""
    user = _user(db)
    practice = _case(db, name="孤儿练习病例")
    practice.status = "published"
    db.flush()
    record = _record(db, user, practice)

    options = practice_options(db, source=record, require_current_revision=_fake_current_revision)

    assert options[PRACTICE_KIND_TRANSFER]["available"] is False
    assert options[PRACTICE_KIND_TRANSFER]["reason"] == REASON_NO_COUNTERPART
