"""系统通知与问卷模板变更的审计判据（真实 PG）。

两者都属于"必审事件"（2026-09-26 审计 A5）：
- 系统通知面向全体用户，建/改/删都会改变学生看到什么；
- 问卷模板决定"学生什么时候被要求答题"，除标题/描述/启用态外，`case_questionnaires`
  的绑定集合变化也要留痕（`assign_cases` 走同一条 `questionnaire_template.updated`，
  payload 里给 before/after 病例 ID 集合）。

payload 只放摘要：通知正文与问卷题目正文都不入审计（量大且可能含个人信息）。
"""

from __future__ import annotations

import re
from datetime import UTC, datetime
from types import SimpleNamespace

import pytest
from sqlalchemy import func

from core.audit import (
    ACTION_NOTIFICATION_CREATED,
    ACTION_NOTIFICATION_DELETED,
    ACTION_NOTIFICATION_UPDATED,
    ACTION_QUESTIONNAIRE_TEMPLATE_CREATED,
    ACTION_QUESTIONNAIRE_TEMPLATE_DELETED,
    ACTION_QUESTIONNAIRE_TEMPLATE_UPDATED,
    TARGET_TYPE_NOTIFICATION,
    TARGET_TYPE_QUESTIONNAIRE_TEMPLATE,
)
from core.database import Base
from core.database import engine as pg_engine
from core.statuses import QuestionnaireTrigger
from models import (
    AuditLog,
    Case,
    CaseQuestionnaire,
    QuestionnaireQuestion,
    QuestionnaireTemplate,
    Role,
    SystemNotification,
    User,
)
from modules.admin.system_notifications import SystemNotificationService
from modules.questionnaires.service import QuestionnaireTemplateService

_TABLES = [
    Role.__table__,
    User.__table__,
    SystemNotification.__table__,
    Case.__table__,
    QuestionnaireTemplate.__table__,
    QuestionnaireQuestion.__table__,
    CaseQuestionnaire.__table__,
    AuditLog.__table__,
]


@pytest.fixture(scope="module", autouse=True)
def _schema():
    Base.metadata.create_all(pg_engine, tables=_TABLES)


@pytest.fixture
def db(pg_session):
    return pg_session


@pytest.fixture
def admin(db) -> User:
    role = db.query(Role).filter(Role.name == "admin").first() or Role(
        name="admin", display_name="管理员", is_system=True
    )
    db.add(role)
    db.flush()
    user = User(
        username="notif-questionnaire-audit-admin",
        password_hash="x",
        role_id=role.id,
        display_name="审计员",
        created_at=datetime.now(UTC),
        updated_at=datetime.now(UTC),
    )
    db.add(user)
    db.flush()
    return user


def _request(actor: User, rid: str, *, method: str = "POST", path: str = "/api/admin/system-notifications"):
    return SimpleNamespace(
        state=SimpleNamespace(request_id=rid, audit_actor=actor),
        headers={"user-agent": "pytest"},
        method=method,
        url=SimpleNamespace(path=path),
    )


def _case(db, name: str) -> Case:
    case = Case(name=name, status="published", is_open=False, case_data={})
    db.add(case)
    db.flush()
    return case


def _template_kwargs(**overrides) -> dict:
    kwargs: dict = {
        "title": "入科问卷",
        "type_": "pre",
        "description": "入科前了解基础",
        "is_active": True,
        "questions": [{"content": "姓名", "question_type": "text", "required": True, "sort_order": 0}],
    }
    kwargs.update(overrides)
    return kwargs


def _audit_rows(db, action: str) -> list[AuditLog]:
    return db.query(AuditLog).filter(AuditLog.action == action).order_by(AuditLog.id).all()


def _digest(value) -> str:
    """指纹形态：sha256 前 12 位十六进制（不校验取值，取值靠跨行比对）。"""
    assert isinstance(value, str), value
    assert re.fullmatch(r"[0-9a-f]{12}", value), value
    return value


def _created_digest(db) -> str:
    return _digest(_audit_rows(db, ACTION_QUESTIONNAIRE_TEMPLATE_CREATED)[0].payload["questions_digest"])


def _linked_case_ids(db, template_id: int) -> list[int]:
    return sorted(
        cq.case_id for cq in db.query(CaseQuestionnaire).filter(CaseQuestionnaire.template_id == template_id).all()
    )


# ── 系统通知 ──


def test_notification_create_records_summary(db, admin):
    content = "本周六 02:00 停机两小时"
    sn = SystemNotificationService(db).create(
        {"title": "停机维护", "content": content, "level": "warning"},
        admin.id,
        request=_request(admin, "req-notif-create"),
    )

    rows = _audit_rows(db, ACTION_NOTIFICATION_CREATED)
    assert len(rows) == 1
    row = rows[0]
    assert row.target_type == TARGET_TYPE_NOTIFICATION
    assert row.target_id == str(sn.id)
    assert row.target_label == "停机维护"
    assert row.actor_id == admin.id
    assert row.request_id == "req-notif-create"
    # payload 与库内实况一致（level/is_active 取实际落库值）
    stored = db.get(SystemNotification, sn.id)
    assert row.payload == {
        "level": stored.level,
        "is_active": stored.is_active,
        "content_length": len(stored.content),
    }
    # 通知正文不入 payload（可能含个人信息）
    assert content not in str(row.payload)


def test_notification_update_records_changed_fields_only(db, admin):
    svc = SystemNotificationService(db)
    sn = svc.create({"title": "停机维护", "content": "本周六 02:00 停机两小时"}, admin.id)

    old_content = "本周六 02:00 停机两小时"
    new_content = "改到周日 03:00"
    svc.update(
        sn.id,
        {"title": "停机维护（改期）", "content": new_content, "level": "info"},
        request=_request(admin, "req-notif-update", method="PUT", path=f"/api/admin/system-notifications/{sn.id}"),
    )

    rows = _audit_rows(db, ACTION_NOTIFICATION_UPDATED)
    assert len(rows) == 1
    row = rows[0]
    assert row.target_id == str(sn.id)
    assert row.target_label == "停机维护（改期）"
    assert row.payload == {
        "title": {"before": "停机维护", "after": "停机维护（改期）"},
        "content": {"before_length": len(old_content), "after_length": len(new_content)},
    }
    stored = db.get(SystemNotification, sn.id)
    assert (stored.title, stored.content, stored.level) == ("停机维护（改期）", new_content, "info")

    # 未发生变化的更新不落行（避免"点一下保存"刷出空审计）
    svc.update(
        sn.id, {"level": "info", "title": "停机维护（改期）"}, request=_request(admin, "req-notif-noop", method="PUT")
    )
    assert len(_audit_rows(db, ACTION_NOTIFICATION_UPDATED)) == 1


def test_notification_delete_records_title_and_level(db, admin):
    svc = SystemNotificationService(db)
    sn = svc.create({"title": "维护完成", "content": "系统已恢复", "level": "success"}, admin.id)

    svc.delete(
        sn.id,
        request=_request(
            admin,
            "req-notif-delete",
            method="DELETE",
            path=f"/api/admin/system-notifications/{sn.id}",
        ),
    )

    rows = _audit_rows(db, ACTION_NOTIFICATION_DELETED)
    assert len(rows) == 1
    row = rows[0]
    assert row.target_id == str(sn.id)
    assert row.target_label == "维护完成"
    assert row.payload == {"level": "success"}
    assert row.request_path == f"/api/admin/system-notifications/{sn.id}"
    assert db.query(SystemNotification).filter(SystemNotification.id == sn.id).count() == 0


# ── 问卷模板 ──


def test_template_create_audits_metadata_summary(db, admin):
    view = QuestionnaireTemplateService(db).create(
        **_template_kwargs(),
        request=_request(admin, "req-q-create", path="/api/questionnaires/templates"),
    )

    rows = _audit_rows(db, ACTION_QUESTIONNAIRE_TEMPLATE_CREATED)
    assert len(rows) == 1
    row = rows[0]
    assert row.target_type == TARGET_TYPE_QUESTIONNAIRE_TEMPLATE
    assert row.target_id == str(view.id)
    assert row.target_label == "入科问卷"
    payload = row.payload
    assert {k: payload[k] for k in ("type", "description", "is_active", "questions_count")} == {
        "type": "pre",
        "description": "入科前了解基础",
        "is_active": True,
        "questions_count": 1,
    }
    # 题目只以「条数 + 指纹」入审计，正文绝不落 payload
    assert "姓名" not in str(payload)
    stored_count = (
        db.query(func.count(QuestionnaireQuestion.id)).filter(QuestionnaireQuestion.template_id == view.id).scalar()
    )
    assert stored_count == payload["questions_count"]

    # 指纹只由题目内容决定：同内容另建一份 → 同值（与行 ID/标题无关）；正文改一字 → 立刻变值
    svc = QuestionnaireTemplateService(db)
    svc.create(**_template_kwargs(title="同题问卷"))
    svc.create(
        **_template_kwargs(
            title="改字问卷",
            questions=[{"content": "姓名（改）", "question_type": "text", "required": True, "sort_order": 0}],
        )
    )
    same_questions_digest = _digest(
        _audit_rows(db, ACTION_QUESTIONNAIRE_TEMPLATE_CREATED)[1].payload["questions_digest"]
    )
    assert same_questions_digest == payload["questions_digest"]
    other_digest = _digest(_audit_rows(db, ACTION_QUESTIONNAIRE_TEMPLATE_CREATED)[2].payload["questions_digest"])
    assert other_digest != payload["questions_digest"]


def test_template_update_audits_field_changes_only(db, admin):
    svc = QuestionnaireTemplateService(db)
    view = svc.create(**_template_kwargs())
    first_question_id = view.questions[0].id

    svc.update(
        view.id,
        title="入科问卷 v2",
        type_="post",
        description="补充说明",
        is_active=False,
        questions=[
            {"id": first_question_id, "content": "姓名", "question_type": "text", "required": True, "sort_order": 0},
            {"content": "既往史", "question_type": "text", "required": False, "sort_order": 1},
        ],
        request=_request(admin, "req-q-update", method="PUT", path=f"/api/questionnaires/templates/{view.id}"),
    )

    rows = _audit_rows(db, ACTION_QUESTIONNAIRE_TEMPLATE_UPDATED)
    assert len(rows) == 1
    row = rows[0]
    assert row.target_id == str(view.id)
    assert row.target_label == "入科问卷 v2"
    payload = row.payload
    assert set(payload) == {"title", "type", "description", "is_active", "questions_count", "questions_digest"}
    assert {k: payload[k] for k in ("title", "type", "description", "is_active", "questions_count")} == {
        "title": {"before": "入科问卷", "after": "入科问卷 v2"},
        "type": {"before": "pre", "after": "post"},
        "description": {"before": "入科前了解基础", "after": "补充说明"},
        "is_active": {"before": True, "after": False},
        "questions_count": {"before": 1, "after": 2},
    }
    # 题目指纹跨行可比：本次的 before 必须等于建模板时记下的那个值
    assert payload["questions_digest"]["before"] == _created_digest(db)
    assert payload["questions_digest"]["after"] != payload["questions_digest"]["before"]
    assert "姓名" not in str(payload)
    stored = db.get(QuestionnaireTemplate, view.id)
    assert (stored.title, stored.type, stored.description, stored.is_active) == (
        "入科问卷 v2",
        "post",
        "补充说明",
        False,
    )
    assert [r.payload["title"]["after"] for r in rows] == [stored.title]

    # 未发生变化的更新不落行
    svc.update(
        view.id,
        title="入科问卷 v2",
        type_="post",
        description="补充说明",
        is_active=False,
        questions=[
            {"content": "姓名", "question_type": "text", "required": True, "sort_order": 0},
            {"content": "既往史", "question_type": "text", "required": False, "sort_order": 1},
        ],
        request=_request(admin, "req-q-noop", method="PUT"),
    )
    assert len(_audit_rows(db, ACTION_QUESTIONNAIRE_TEMPLATE_UPDATED)) == 1


def test_template_update_audits_question_body_change(db, admin):
    """只改某题正文（条数/标题都不变）也必须留一行：正文不进 payload，指纹进。"""
    svc = QuestionnaireTemplateService(db)
    view = svc.create(**_template_kwargs())
    question = view.questions[0]

    def _put(content: str):
        svc.update(
            view.id,
            title=None,
            type_=None,
            description=None,
            is_active=None,
            questions=[
                {
                    "id": question.id,
                    "content": content,
                    "question_type": question.question_type,
                    "required": question.required,
                    "sort_order": question.sort_order,
                }
            ],
            request=_request(admin, "req-q-body", method="PUT"),
        )

    _put("姓名（含紧急联系人）")

    rows = _audit_rows(db, ACTION_QUESTIONNAIRE_TEMPLATE_UPDATED)
    assert len(rows) == 1
    payload = rows[0].payload
    assert set(payload) == {"questions_digest"}
    assert payload["questions_digest"]["before"] == _created_digest(db)
    assert payload["questions_digest"]["after"] != payload["questions_digest"]["before"]
    assert "紧急联系人" not in str(payload)
    stored = db.query(QuestionnaireQuestion).filter(QuestionnaireQuestion.id == question.id).one()
    assert stored.content == "姓名（含紧急联系人）"

    # 幂等反例：同一份内容再 PUT 一次不再新增行
    _put("姓名（含紧急联系人）")
    assert len(_audit_rows(db, ACTION_QUESTIONNAIRE_TEMPLATE_UPDATED)) == 1


def test_template_update_with_binding_change_is_audited(db, admin):
    """「改」的端到端判据：字段变更与病例绑定集合变化各留一行，且都能与库内实况对上。"""
    svc = QuestionnaireTemplateService(db)
    view = svc.create(**_template_kwargs())
    case_a = _case(db, "绑定用例 A")
    case_b = _case(db, "绑定用例 B")

    svc.assign_cases(
        view.id,
        [case_a.id],
        is_required=True,
        trigger_event=QuestionnaireTrigger.BEFORE_TRAINING,
        request=_request(
            admin,
            "req-bind-1",
            method="PUT",
            path=f"/api/questionnaires/templates/{view.id}/case-assignments",
        ),
    )
    svc.update(
        view.id,
        title="入科问卷 v2",
        type_=None,
        description=None,
        is_active=False,
        questions=None,
        request=_request(admin, "req-q-change", method="PUT"),
    )
    svc.assign_cases(
        view.id,
        [case_a.id, case_b.id],
        is_required=True,
        trigger_event=QuestionnaireTrigger.BEFORE_TRAINING,
        request=_request(admin, "req-bind-2", method="PUT"),
    )

    rows = _audit_rows(db, ACTION_QUESTIONNAIRE_TEMPLATE_UPDATED)
    assert [r.request_id for r in rows] == ["req-bind-1", "req-q-change", "req-bind-2"]
    # 绑定集合：前后不同，且 after 与 case_questionnaires 实况一致
    assert rows[0].payload == {"case_ids": {"before": [], "after": [case_a.id]}}
    assert rows[2].payload == {"case_ids": {"before": [case_a.id], "after": [case_a.id, case_b.id]}}
    assert rows[2].payload["case_ids"]["before"] != rows[2].payload["case_ids"]["after"]
    assert _linked_case_ids(db, view.id) == rows[2].payload["case_ids"]["after"]
    # 字段变更行
    assert rows[1].payload == {
        "title": {"before": "入科问卷", "after": "入科问卷 v2"},
        "is_active": {"before": True, "after": False},
    }
    stored = db.get(QuestionnaireTemplate, view.id)
    assert (stored.title, stored.is_active) == ("入科问卷 v2", False)

    # 绑定集合无变化 → 不落行（与班级成员变更口径一致）
    svc.assign_cases(
        view.id,
        [case_b.id, case_a.id],
        is_required=False,
        trigger_event=QuestionnaireTrigger.AFTER_SCORING,
        request=_request(admin, "req-bind-3", method="PUT"),
    )
    assert len(_audit_rows(db, ACTION_QUESTIONNAIRE_TEMPLATE_UPDATED)) == 3
    # 但 is_required / trigger_event 仍按请求更新（两条绑定行都换新值）
    links = db.query(CaseQuestionnaire).filter(CaseQuestionnaire.template_id == view.id).all()
    assert {(link.is_required, link.trigger_event) for link in links} == {(False, "after_scoring")}


def test_template_delete_audits_title_and_case_binding(db, admin):
    svc = QuestionnaireTemplateService(db)
    view = svc.create(**_template_kwargs())
    case = _case(db, "待删绑定用例")
    svc.assign_cases(
        view.id,
        [case.id],
        is_required=True,
        trigger_event=QuestionnaireTrigger.BEFORE_TRAINING,
        request=_request(admin, "req-bind-before-delete", method="PUT"),
    )

    svc.delete(
        view.id,
        request=_request(admin, "req-q-delete", method="DELETE", path=f"/api/questionnaires/templates/{view.id}"),
    )

    rows = _audit_rows(db, ACTION_QUESTIONNAIRE_TEMPLATE_DELETED)
    assert len(rows) == 1
    row = rows[0]
    assert row.target_id == str(view.id)
    assert row.target_label == "入科问卷"
    payload = row.payload
    assert {k: payload[k] for k in ("case_bound", "bound_case_count", "questions_count")} == {
        "case_bound": True,
        "bound_case_count": 1,
        "questions_count": 1,
    }
    # 删除行带上删除前的题目指纹，可与建/改行逐行比对
    assert payload["questions_digest"] == _created_digest(db)
    assert db.query(QuestionnaireTemplate).filter(QuestionnaireTemplate.id == view.id).count() == 0
    assert _linked_case_ids(db, view.id) == []
