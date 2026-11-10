"""问卷答卷浏览（GET /api/questionnaires/responses/{template_id}[/{response_id}]）。

验收锁定在**响应体对外契约**上：

① 列表带真实分页与 total（offset/limit 生效，不是全量塞一页）；
② 筛选可由已有字段支撑：提交状态、触发时点（由 ``record_id`` 推导）、学生姓名；
③ 单份详情能拿到作答人、触发时点、提交时间与**全部**题目答案（含必答标记与选项）；
④ 详情只认本模板 + 本校范围：他校答卷一律 404，不泄露存在性；
⑤ 模板不存在 / 答卷不存在都是 404，而不是空 200。
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient

from core.access import clear_access_cache
from core.database import get_db
from core.personas import persona_permissions
from core.security import get_current_user
from main import app
from models import (
    Case,
    CaseQuestionnaire,
    Class,
    ClassMembership,
    QuestionnaireAnswer,
    QuestionnaireQuestion,
    QuestionnaireResponse,
    QuestionnaireTemplate,
    School,
    TrainingRecord,
    User,
    UserSchoolPersona,
)

NOW = datetime.now(UTC)


def _school(db, name: str) -> School:
    school = School(name=name, created_at=NOW)
    db.add(school)
    db.flush()
    return school


def _person(db, username: str, school: School | None, persona: str, **fields) -> User:
    user = User(
        username=username,
        password_hash="x",
        display_name=fields.pop("display_name", username),
        school_id=school.id if school else None,
        created_at=NOW,
        updated_at=NOW,
        **fields,
    )
    db.add(user)
    db.flush()
    if school is not None:
        db.add(UserSchoolPersona(user_id=user.id, school_id=school.id, persona=persona))
        db.flush()
        user.set_active_persona(persona)
    user.set_permissions_cache(set(persona_permissions(persona)))
    clear_access_cache()
    return user


def _template(db, title: str = "训练前问卷") -> QuestionnaireTemplate:
    t = QuestionnaireTemplate(title=title, type="pre", description=None, is_active=True)
    db.add(t)
    db.flush()
    return t


def _question(db, template: QuestionnaireTemplate, content: str, qtype: str, order: int, **fields):
    q = QuestionnaireQuestion(
        template_id=template.id,
        content=content,
        question_type=qtype,
        required=fields.pop("required", True),
        sort_order=order,
        options=fields.pop("options", None),
    )
    db.add(q)
    db.flush()
    return q


def _case(db, name: str = "社区获得性肺炎") -> Case:
    case = Case(name=name, description="", case_data={"name": name}, is_open=True, status="published")
    db.add(case)
    db.flush()
    return case


def _record(db, student: User, case: Case) -> TrainingRecord:
    record = TrainingRecord(
        user_id=student.id,
        case_id=case.id,
        status="completed",
        scoring_status="completed",
        start_time=NOW - timedelta(hours=1),
    )
    db.add(record)
    db.flush()
    return record


def _response(db, *, template, student, case=None, record=None, answers, when=None) -> QuestionnaireResponse:
    resp = QuestionnaireResponse(
        template_id=template.id,
        user_id=student.id,
        case_id=case.id if case else None,
        record_id=record.id if record else None,
        status="completed",
        completed_at=when or NOW,
        created_at=when or NOW,
    )
    db.add(resp)
    db.flush()
    for question_id, value in answers:
        db.add(QuestionnaireAnswer(response_id=resp.id, question_id=question_id, answer_value=value))
    db.flush()
    return resp


@pytest.fixture
def world(pg_session):
    db = pg_session
    school = _school(db, "本校")
    other_school = _school(db, "他校")

    teacher = _person(db, "teacher", school, "teacher")
    student_a = _person(db, "stu-a", school, "student", display_name="甲同学")
    student_b = _person(db, "stu-b", school, "student", display_name="乙同学")
    outsider = _person(db, "stu-other", other_school, "student", display_name="外校同学")

    klass = Class(name="护理2401", cohort_label="2026级", school_id=school.id, created_at=NOW)
    db.add(klass)
    db.flush()
    for student in (student_a, student_b):
        db.add(ClassMembership(user_id=student.id, class_id=klass.id, member_role="student", joined_at=NOW))
    db.flush()

    template = _template(db)
    q1 = _question(db, template, "本次训练难度", "likert_5", 1)
    q2 = _question(db, template, "你遇到了哪些困难", "multiple_choice", 2, options=["病史采集", "沟通"])
    q3 = _question(db, template, "还有补充吗", "short_text", 3, required=False)

    case = _case(db)
    db.add(
        CaseQuestionnaire(case_id=case.id, template_id=template.id, is_required=True, trigger_event="before_training")
    )
    db.flush()

    pre_response = _response(
        db,
        template=template,
        student=student_a,
        case=case,
        answers=[(q1.id, "5"), (q2.id, "病史采集"), (q3.id, None)],
        when=NOW - timedelta(days=1),
    )
    record = _record(db, student_b, case)
    post_response = _response(
        db,
        template=template,
        student=student_b,
        case=case,
        record=record,
        answers=[(q1.id, "3"), (q2.id, "沟通"), (q3.id, "想再练一次")],
        when=NOW,
    )
    other_response = _response(
        db,
        template=template,
        student=outsider,
        case=case,
        answers=[(q1.id, "1")],
        when=NOW - timedelta(hours=2),
    )

    return {
        "db": db,
        "school": school,
        "teacher": teacher,
        "student_a": student_a,
        "student_b": student_b,
        "outsider": outsider,
        "template": template,
        "q1": q1,
        "q2": q2,
        "q3": q3,
        "case": case,
        "record": record,
        "pre_response": pre_response,
        "post_response": post_response,
        "other_response": other_response,
    }


@pytest.fixture
def client(pg_session):
    def _db():
        yield pg_session

    before = dict(app.dependency_overrides)
    app.dependency_overrides[get_db] = _db
    try:

        def as_(user):
            app.dependency_overrides[get_current_user] = lambda: user
            return TestClient(app)

        yield as_
    finally:
        app.dependency_overrides = before


def _list(client, template_id: int, **params):
    return client.get(f"/api/questionnaires/responses/{template_id}", params=params)


def test_list_paginates_and_hides_other_schools(world, client):
    template_id = world["template"].id

    page = _list(client(world["teacher"]), template_id, offset=0, limit=1)
    assert page.status_code == 200, page.text
    body = page.json()
    # 他校答卷不计入 total：收窄发生在查询里，不是取回后过滤
    assert body["total"] == 2
    assert len(body["items"]) == 1
    assert body["items"][0]["user_id"] == world["student_b"].id

    second = _list(client(world["teacher"]), template_id, offset=1, limit=1).json()
    assert len(second["items"]) == 1
    assert second["items"][0]["user_id"] == world["student_a"].id


def test_list_exposes_trigger_event_and_case_name(world, client):
    ids = {i["id"]: i for i in _list(client(world["teacher"]), world["template"].id).json()["items"]}
    pre = ids[world["pre_response"].id]
    post = ids[world["post_response"].id]

    assert pre["trigger_event"] == "before_training"
    assert pre["record_id"] is None
    assert post["trigger_event"] == "after_scoring"
    assert post["record_id"] == world["record"].id
    assert post["case_name"] == "社区获得性肺炎"


def test_list_filters_by_trigger_event_and_search(world, client):
    template_id = world["template"].id

    only_post = _list(client(world["teacher"]), template_id, trigger_event="after_scoring").json()
    assert [i["id"] for i in only_post["items"]] == [world["post_response"].id]

    only_pre = _list(client(world["teacher"]), template_id, trigger_event="before_training").json()
    assert [i["id"] for i in only_pre["items"]] == [world["pre_response"].id]

    searched = _list(client(world["teacher"]), template_id, search="乙同").json()
    assert [i["id"] for i in searched["items"]] == [world["post_response"].id]


def test_status_filter_excludes_pending(world, client):
    """``pending`` 答卷在列表默认口径（completed）里不出现，显式 ``status=pending`` 才出现。"""
    db = world["db"]
    outro = _person(db, "stu-c", world["school"], "student", display_name="丙同学")
    db.add(
        QuestionnaireResponse(
            template_id=world["template"].id,
            user_id=outro.id,
            case_id=world["case"].id,
            record_id=None,
            status="pending",
            completed_at=None,
            created_at=NOW,
        )
    )
    db.flush()

    completed = _list(client(world["teacher"]), world["template"].id, status="completed").json()
    assert completed["total"] == 2

    pending = _list(client(world["teacher"]), world["template"].id, status="pending").json()
    assert pending["total"] == 1
    assert pending["items"][0]["user_name"] == "丙同学"


def test_detail_returns_every_answer_with_meta(world, client):
    resp = client(world["teacher"]).get(
        f"/api/questionnaires/responses/{world['template'].id}/{world['post_response'].id}"
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()

    assert body["user_id"] == world["student_b"].id
    assert body["user_name"] == "乙同学"
    assert body["trigger_event"] == "after_scoring"
    assert body["record_id"] == world["record"].id
    assert body["completed_at"] is not None

    answers = {a["question_id"]: a for a in body["answers"]}
    assert set(answers) == {world["q1"].id, world["q2"].id, world["q3"].id}
    assert answers[world["q2"].id]["options"] == ["病史采集", "沟通"]
    assert answers[world["q2"].id]["answer_value"] == "沟通"
    assert answers[world["q3"].id]["required"] is False
    assert answers[world["q3"].id]["answer_value"] == "想再练一次"


def test_detail_keeps_unanswered_optional_question(world, client):
    """未作答的选答题也要出现（``answer_value`` 为空），否则详情会"少一题"。"""
    body = (
        client(world["teacher"])
        .get(f"/api/questionnaires/responses/{world['template'].id}/{world['pre_response'].id}")
        .json()
    )
    answers = {a["question_id"]: a for a in body["answers"]}
    assert world["q3"].id in answers
    assert answers[world["q3"].id]["answer_value"] is None


def test_detail_of_other_school_is_404(world, client):
    resp = client(world["teacher"]).get(
        f"/api/questionnaires/responses/{world['template'].id}/{world['other_response'].id}"
    )
    assert resp.status_code == 404


def test_detail_rejects_template_mismatch(world, client):
    other_template = _template(world["db"], "另一个问卷")
    resp = client(world["teacher"]).get(
        f"/api/questionnaires/responses/{other_template.id}/{world['post_response'].id}"
    )
    assert resp.status_code == 404


def test_missing_template_and_response_are_404(world, client):
    c = client(world["teacher"])
    assert c.get("/api/questionnaires/responses/999999").status_code == 404
    assert c.get(f"/api/questionnaires/responses/{world['template'].id}/999999").status_code == 404


def test_requires_questionnaire_manage_permission(world, client):
    """学生读不到答卷列表：门是 ``questionnaire_manage``。"""
    assert _list(client(world["student_a"]), world["template"].id).status_code == 403


def test_export_requires_questionnaire_manage_not_just_export_data(world, client):
    """运维式 ``export_data`` 不能越过问卷的查看/管理权限导出自由文本。"""
    ops = _person(world["db"], "ops-a", world["school"], "ops")
    assert ops.has_permission("export_data")
    assert not ops.has_permission("questionnaire_manage")
    resp = client(ops).post(f"/api/questionnaires/responses/{world['template'].id}/export")
    assert resp.status_code == 403


def test_stats_is_not_captured_by_response_detail_route(world, client):
    """静态 stats 必须先于 ``{response_id}``，否则 "stats" 会被当成整数 id。"""
    resp = client(world["teacher"]).get(f"/api/questionnaires/responses/{world['template'].id}/stats")
    assert resp.status_code == 200, resp.text
    assert resp.json()["template_id"] == world["template"].id
