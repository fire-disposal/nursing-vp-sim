"""病例发布生命周期（docs/15 §六）：status + CaseRevision + 元数据单源 + 发布门禁。

用 SQLite 上复制一份元数据（JSONB → JSON）跑真实 ORM/service 路径。发布门禁与 CI
病例审计共用 modules/cases/validator.py，所以这里的 error 断言同时就是「非法配置
发布即失败」的回归；已发布 revision 的不可变性、编辑产生新版本、归档只阻止新使用
也都在此覆盖。
"""

from __future__ import annotations

import importlib.util
import sys
from datetime import UTC, datetime
from pathlib import Path

import pytest
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Session

from core.exceptions import ConflictError
from models import (
    CASE_STATUS_ARCHIVED,
    CASE_STATUS_DRAFT,
    CASE_STATUS_PUBLISHED,
    Assignment,
    AssignmentRecipient,
    Case,
    CaseRevision,
    Class,
    ClassMembership,
    Notification,
    Role,
    Score,
    TrainingRecord,
    User,
)
from models.school import legacy_grades_table
from modules.assignments.service import AssignmentService
from modules.cases.gate import CaseNotPublishableError
from modules.cases.revisions import require_current_revision, require_publishable
from modules.cases.service import CaseService
from modules.training.manifest import build_session_manifest
from modules.training.profile import HISTORY_TAKING

_SOURCE_TABLES = [
    legacy_grades_table,
    Role.__table__,
    User.__table__,
    Class.__table__,
    ClassMembership.__table__,
    Case.__table__,
    CaseRevision.__table__,
    Assignment.__table__,
    AssignmentRecipient.__table__,
    TrainingRecord.__table__,
    Score.__table__,
    Notification.__table__,
]

#: 最小可过门禁的病例内容（一条查体声明 + 3 条示例对话）
_VALID_CONTENT: dict = {
    "description": "门禁测试病例",
    "patient_info": {"name": "测试患者", "age": 40, "gender": "男"},
    "chief_complaint": "咳嗽三天",
    "example_dialogues": [{"q": "哪不舒服", "a": "咳嗽"}, {"q": "多久了", "a": "三天"}, {"q": "有痰吗", "a": "有"}],
    "activities": {"physical_exam": {"config": {"vital_signs": {"temp": "36.5-37.2"}}}},
}


def _payload(**overrides) -> dict:
    """写路径入参：内容 + 元数据键（元数据落库前被剥离到列）。"""
    return {"name": "门禁测试病例", "difficulty": 1, "time_limit": 30, **_VALID_CONTENT, **overrides}


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


def _create(db: Session, **overrides) -> Case:
    svc = CaseService(db)
    svc.create(_payload(**overrides), user_id=1, user_role="admin")
    return db.query(Case).order_by(Case.id.desc()).first()


def _revision(db: Session, case: Case) -> CaseRevision:
    return db.get(CaseRevision, case.current_revision_id)


# ── 元数据单源 ────────────────────────────────────────────────────────────


def test_create_is_draft_and_stores_metadata_in_columns_only(db):
    case = _create(db)

    assert case.status == CASE_STATUS_DRAFT
    assert (case.name, case.difficulty, case.time_limit_minutes) == ("门禁测试病例", 1, 30)
    # case_data 里不再重复保存元数据键（docs/15 §六、§十五.3）
    for key in ("name", "difficulty", "time_limit"):
        assert key not in case.case_data
    # 内容本身（含 Activity 声明）原样保留
    assert case.case_data["activities"] == _VALID_CONTENT["activities"]
    assert case.current_revision_id is None


def test_retired_field_is_reported_not_silently_dropped(db):
    """已退场字段（training_type）不再被剥掉：写路径不静默丢数据，发布门禁点名它。

    对存量旧值的唯一解释路径是数据迁移 e6b2c3d4e5f6（单向）；应用侧遇到该字段
    只报告不隐藏。
    """
    case = _create(db, training_type="history_taking")

    assert case.case_data["training_type"] == "history_taking"

    _, report = CaseService(db).publish(case.id, user_id=1, user_role="admin")

    assert "training_type" in [i.field for i in report.warnings]
    assert report.errors == []


def test_metadata_only_edit_keeps_the_same_revision(db):
    case = _create(db)
    CaseService(db).publish(case.id, user_id=1, user_role="admin")
    first = _revision(db, case)

    CaseService(db).update(case.id, _payload(difficulty=2), user_id=1, user_role="admin")

    assert case.difficulty == 2
    assert case.current_revision_id == first.id
    assert db.query(CaseRevision).count() == 1


def test_update_without_metadata_keeps_column_values(db):
    case = _create(db)
    CaseService(db).publish(case.id, user_id=1, user_role="admin")

    CaseService(db).update(case.id, {**_VALID_CONTENT, "name": "门禁测试病例"}, user_id=1, user_role="admin")

    assert (case.difficulty, case.time_limit_minutes) == (1, 30)


# ── 发布门禁 ──────────────────────────────────────────────────────────────


def test_publish_creates_first_revision(db):
    case = _create(db)

    view, report = CaseService(db).publish(case.id, user_id=7, user_role="admin")

    assert report.errors == []
    assert view.status == CASE_STATUS_PUBLISHED
    assert view.current_revision_no == 1
    revision = _revision(db, case)
    assert revision.revision_no == 1
    assert revision.created_by == 7
    assert revision.published_at is not None
    assert revision.content == case.case_data


def test_publish_rejects_content_the_kernel_does_not_know(db):
    case = _create(db, activities={"no_such_activity": {"config": {}}})

    with pytest.raises(CaseNotPublishableError) as exc:
        CaseService(db).publish(case.id, user_id=1, user_role="admin")

    assert [(i.field, i.severity) for i in exc.value.report.errors] == [("activities.no_such_activity", "error")]
    db.rollback()
    assert case.status == CASE_STATUS_DRAFT
    assert db.query(CaseRevision).count() == 0


def test_publish_requires_activities_declaration(db):
    case = _create(db, activities={})
    case.case_data = {k: v for k, v in case.case_data.items() if k != "activities"}
    db.commit()

    with pytest.raises(CaseNotPublishableError) as exc:
        CaseService(db).publish(case.id, user_id=1, user_role="admin")

    assert exc.value.report.errors[0].field == "activities"


# ── 版本不可变 / 编辑产生新版本 ────────────────────────────────────────────


def test_edit_of_published_case_appends_revision_and_freezes_old_content(db):
    case = _create(db)
    CaseService(db).publish(case.id, user_id=1, user_role="admin")
    first = _revision(db, case)
    first_content = dict(first.content)

    view = CaseService(db).update(case.id, _payload(chief_complaint="咳嗽五天"), user_id=1, user_role="admin")

    assert view.current_revision_no == 2  # 视图立即反映新版本（不读缓存关系）
    revisions = db.query(CaseRevision).order_by(CaseRevision.revision_no).all()
    assert [r.revision_no for r in revisions] == [1, 2]
    assert revisions[0].content == first_content  # 旧版本内容不可变
    assert revisions[1].content["chief_complaint"] == "咳嗽五天"
    assert case.current_revision_id == revisions[1].id


def test_invalid_edit_of_published_case_changes_nothing(db):
    case = _create(db)
    CaseService(db).publish(case.id, user_id=1, user_role="admin")
    first = _revision(db, case)
    stored = dict(case.case_data)

    with pytest.raises(CaseNotPublishableError):
        CaseService(db).update(
            case.id, _payload(activities={"no_such_activity": {"config": {}}}), user_id=1, user_role="admin"
        )

    db.rollback()
    assert case.case_data == stored
    assert case.current_revision_id == first.id
    assert db.query(CaseRevision).count() == 1


# ── 使用门：发布/归档/编辑 ────────────────────────────────────────────────


def test_draft_and_archived_cases_cannot_start_new_use(db):
    draft = _create(db)
    with pytest.raises(ConflictError):
        require_current_revision(db, draft)

    CaseService(db).publish(draft.id, user_id=1, user_role="admin")
    assert require_current_revision(db, draft).revision_no == 1

    CaseService(db).archive(draft.id, user_id=1, user_role="admin")
    db.refresh(draft)
    assert draft.status == CASE_STATUS_ARCHIVED
    with pytest.raises(ConflictError):
        require_publishable(draft)
    with pytest.raises(ConflictError):
        require_current_revision(db, draft)
    # 归档不删版本：历史训练仍能解析到自己的版本
    assert db.get(CaseRevision, draft.current_revision_id) is not None


def test_archived_case_is_read_only(db):
    case = _create(db)
    CaseService(db).publish(case.id, user_id=1, user_role="admin")
    CaseService(db).archive(case.id, user_id=1, user_role="admin")

    with pytest.raises(ConflictError):
        CaseService(db).update(case.id, _payload(), user_id=1, user_role="admin")


def _assignment(db: Session, case: Case, *, class_id: int = 1):
    return AssignmentService(db).create(
        case_id=case.id,
        class_id=class_id,
        title="作业",
        description=None,
        features={},
        behavior={},
        audience_mode="class",
        recipient_user_ids=None,
        start_time=datetime(2026, 1, 1, tzinfo=UTC),
        end_time=datetime(2026, 12, 31, tzinfo=UTC),
        teacher_id=1,
    )


def _school(db: Session) -> None:
    now = datetime.now(UTC)
    db.add(Role(id=1, name="teacher", display_name="教师", is_system=True))
    db.add(User(id=1, username="t1", password_hash="x", role_id=1, display_name="t1", created_at=now, updated_at=now))
    db.add(Class(id=1, name="1班", cohort_label="2026级"))
    db.commit()


def test_draft_case_cannot_be_used_by_assignment(db):
    _school(db)
    case = _create(db)

    with pytest.raises(ConflictError):
        _assignment(db, case)


def test_archived_case_cannot_be_used_by_assignment(db):
    _school(db)
    case = _create(db)
    CaseService(db).publish(case.id, user_id=1, user_role="admin")
    CaseService(db).archive(case.id, user_id=1, user_role="admin")

    with pytest.raises(ConflictError):
        _assignment(db, case)


def test_published_case_pins_its_revision_on_assignment(db):
    _school(db)
    case = _create(db)
    CaseService(db).publish(case.id, user_id=1, user_role="admin")

    view = _assignment(db, case)

    assert view.case_id == case.id
    assert db.query(Assignment).filter(Assignment.id == view.id).first().case_revision_id == case.current_revision_id


def test_open_requires_published(db):
    case = _create(db)  # is_open 默认为 True，但未发布
    CaseService(db).set_open(case.id, is_open=False)
    with pytest.raises(ConflictError):
        CaseService(db).set_open(case.id, is_open=True)


# ── 列表口径 ──────────────────────────────────────────────────────────────


def test_student_list_only_shows_published_and_open(db):
    draft = _create(db)
    published = _create(db, name="已发布病例")
    CaseService(db).publish(published.id, user_id=1, user_role="admin")
    archived = _create(db, name="归档病例")
    CaseService(db).publish(archived.id, user_id=1, user_role="admin")
    CaseService(db).archive(archived.id, user_id=1, user_role="admin")

    items, total = CaseService(db).list_brief(0, 50)

    assert total == 1
    assert [c.id for c in items] == [published.id]
    assert draft.id != published.id


def test_manage_list_hides_archived_by_default(db):
    draft = _create(db)
    archived = _create(db, name="归档病例")
    CaseService(db).publish(archived.id, user_id=1, user_role="admin")
    CaseService(db).archive(archived.id, user_id=1, user_role="admin")
    svc = CaseService(db)

    default_views, default_total = svc.list_manage(0, 50)
    archived_views, archived_total = svc.list_manage(0, 50, status=CASE_STATUS_ARCHIVED)

    assert [v.id for v in default_views] == [draft.id]
    assert default_total == 1
    assert [v.id for v in archived_views] == [archived.id]
    assert archived_total == 1


# ── 会话 manifest 的版本投影 ──────────────────────────────────────────────


def test_session_manifest_carries_pinned_revision():
    manifest = build_session_manifest(
        session_id=1,
        status="completed",
        revision=4,
        case_data=_VALID_CONTENT,
        workflow=HISTORY_TAKING,
        case_id=7,
        case_revision_id=21,
        case_revision_no=3,
    )

    assert manifest["case"] == {"case_id": 7, "revision_id": 21, "revision_no": 3}


def test_session_manifest_of_legacy_record_has_no_revision():
    """迁移前的记录只有 case_snapshot：版本字段为空，但 manifest 仍可用（可复盘）。"""
    manifest = build_session_manifest(
        session_id=1, status="completed", revision=0, case_data=_VALID_CONTENT, workflow=HISTORY_TAKING, case_id=7
    )

    assert manifest["case"] == {"case_id": 7, "revision_id": None, "revision_no": None}
    # 会话已结束：Activity 一律不可用（但 manifest 仍然可解析，复盘不被版本缺失阻断）
    assert {a["id"] for a in manifest["activities"]} == set(HISTORY_TAKING.activities)
    assert all(a["availability"]["state"] == "unavailable" for a in manifest["activities"])


# ── e6 数据迁移的能力声明换轨（``tools.*`` → ``activities.<id>.config``）──────────
# 迁移是历史文件，按路径加载 —— 单向换轨的唯一实现就在这里（一次性转换脚本已在
# 迁移落地后删除），只验纯转换函数与升级里的指纹改写顺序：升级本身在 alembic 里跑，
# 不在这里起库。

_MIGRATION_PATH = (
    Path(__file__).resolve().parents[2] / "migrations" / "versions" / "data" / "e6b2c3d4e5f6_backfill_case_revisions.py"
)
_spec = importlib.util.spec_from_file_location("e6_backfill_case_revisions", _MIGRATION_PATH)
assert _spec is not None
assert _spec.loader is not None
revision_migration = importlib.util.module_from_spec(_spec)
sys.modules[_spec.name] = revision_migration  # 让模块可被 import 机制解析
_spec.loader.exec_module(revision_migration)


def _legacy_case_data() -> dict:
    """旧形状 ``case_data``（已剥元数据）：tools.* 与各 Activity 的载荷。"""
    return {
        "description": "旧形状病例",
        "patient_info": {"name": "测试患者", "age": 40, "gender": "男"},
        "tools": {
            "physical_exam": {"vital_signs": {"temperature": "38.5"}},
            "nursing_record": True,
            "quiz": {"questions": [{"id": "q1"}]},
        },
    }


def test_migration_converts_legacy_tools_into_activities():
    converted = revision_migration._migrate_case_activities(1, _legacy_case_data())

    assert "tools" not in converted
    assert converted["activities"] == {
        "physical_exam": {"config": {"vital_signs": {"temperature": "38.5"}}},
        "nursing_record": {"config": True},
        "quiz": {"config": {"questions": [{"id": "q1"}]}},
    }
    assert converted["description"] == "旧形状病例"  # 非能力字段原样保留


def test_migration_merges_top_level_exam_anchors_with_tools_winning():
    content = {**_legacy_case_data(), "exam_anchors": {"vital_signs": {"temperature": "37.0"}, "pain_score": 3}}

    converted = revision_migration._migrate_case_activities(1, content)

    config = converted["activities"]["physical_exam"]["config"]
    assert config["vital_signs"] == {"temperature": "38.5"}  # tools.physical_exam 覆盖同名键
    assert config["pain_score"] == 3  # 仅 exam_anchors 提供的键并入
    assert "exam_anchors" not in converted


def test_migration_is_idempotent_and_preserves_existing_activities():
    # 已迁移（重跑）：既有声明原样返回
    assert revision_migration._migrate_case_activities(
        1, {"description": "新形状病例", "activities": {"quiz": {"config": {"questions": []}}}}
    ) == {"description": "新形状病例", "activities": {"quiz": {"config": {"questions": []}}}}
    # 部分迁移（新旧形状并存）：既有声明不被改写，旧形状键也不丢（只记 warning）
    assert revision_migration._migrate_case_activities(
        1,
        {
            "description": "新形状病例",
            "activities": {"quiz": {"config": {"questions": []}}},
            "tools": {"quiz": {"questions": []}},
        },
    ) == {
        "description": "新形状病例",
        "activities": {"quiz": {"config": {"questions": []}}},
        "tools": {"quiz": {"questions": []}},
    }


def test_migration_refuses_to_silently_drop_unmappable_tools():
    for tools in (["not", "an", "object"], {"telepathy": {}}, {"nursing_diagnosis": {"enabled": True}}):
        content = {"description": "坏行", "tools": tools}
        with pytest.raises(revision_migration.MigrationDataError):
            revision_migration._migrate_case_activities(1, content)


def test_migration_seed_hash_is_recomputed_from_converted_content():
    from modules.cases.builtin_sync import content_hash, is_locally_edited

    legacy = {"name": "旧病例", **_legacy_case_data()}  # 旧指纹按「含元数据」算法生成（元数据当时还在 payload 里）
    legacy_bookmark = revision_migration._content_hash(legacy, ignore_metadata=False)
    content, payload, bookmark = revision_migration._split_payload({**legacy, "_seed_hash": legacy_bookmark})
    assert bookmark == legacy_bookmark
    # 升级的「未改动」判定：在换轨前的 payload 上按旧算法比对 —— 命中后指纹才按换轨后的内容重算
    assert bookmark == revision_migration._content_hash(payload, ignore_metadata=False)

    converted = revision_migration._migrate_case_activities(1, content)
    fresh = revision_migration._content_hash(converted, ignore_metadata=True)
    assert fresh == content_hash(converted)  # 冻结副本 == 现行算法（指纹与仓库病例对齐）

    assert is_locally_edited({**converted, "_seed_hash": fresh}) is False  # 未改动 → seed 可收敛
    assert is_locally_edited({**converted, "_seed_hash": legacy_bookmark}) is True  # 教师改过 → seed 让路
