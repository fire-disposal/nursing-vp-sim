"""学生作业详情（GET /api/students/assignments/{id}）——HTTP 边界行为锁。

覆盖的验收：
  ① 本人能看到作业要求（说明/病例/班级/起止/模式/隐藏病例/次数）与**本人全部**尝试；
  ② 不是该班学生成员 → 404（移出班级即失去可见性）；
  ③ 是班级成员但不在发布受众快照 → 404（指定名单里没有他）；
  ④ 不依赖 ``assignment_manage`` 权限：没有该权限的学生也能读自己的作业；
  ⑤ 隐藏病例的作业不披露病例名；
  ⑥ 关闭/过期仍可看完整历史（lifecycle 区分 active/ended/closed，attempts 不缩水）；
  ⑦ 尝试次数与剩余次数按同一口径（in_progress 不计入已用次数）。

这些断言都落在**响应体对外契约**上，不镜像服务层实现。
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient

from core.database import get_db
from core.security import get_current_user
from main import app
from models import Assignment, AssignmentRecipient, Case, CaseRevision, Class, ClassMembership, Score, TrainingRecord
from tests.conftest import ensure_school, make_user

CASE_DATA = {
    "name": "社区获得性肺炎",
    "patient_info": {"name": "张伟", "age": 54, "gender": "男"},
    "chief_complaint": "咳嗽三天",
}

LONG_DESCRIPTION = "请按护理程序完成完整病史采集。" * 40  # 800 字，长文本边界


def _case(
    pg_session,
    school,
    *,
    name: str = "社区获得性肺炎",
    is_open: bool = True,
    content: dict | None = None,
    time_limit_minutes: int = 20,
) -> Case:
    payload = dict(CASE_DATA if content is None else content)
    payload.setdefault("name", name)
    case = Case(
        name=name,
        description="",
        case_data=payload,
        is_open=is_open,
        status="published",
        time_limit_minutes=time_limit_minutes,
    )
    pg_session.add(case)
    pg_session.flush()
    revision = CaseRevision(case_id=case.id, revision_no=1, content=payload, created_by=None)
    pg_session.add(revision)
    pg_session.flush()
    case.current_revision_id = revision.id
    pg_session.flush()
    return case


def _class(pg_session, school, name: str = "护理2401") -> Class:
    klass = Class(name=name, school_id=school.id)
    pg_session.add(klass)
    pg_session.flush()
    return klass


def _member(pg_session, user, klass) -> None:
    pg_session.add(ClassMembership(user_id=user.id, class_id=klass.id, member_role="student"))
    pg_session.flush()


def _assignment(
    pg_session,
    *,
    case: Case,
    klass: Class,
    teacher,
    recipients: list,
    description: str | None = "请按护理程序完成完整病史采集。",
    behavior: dict | None = None,
    max_attempts: int | None = 2,
    start_offset: int = -3600,
    end_offset: int = 3600,
    is_closed: bool = False,
) -> Assignment:
    now = datetime.now(UTC)
    assignment = Assignment(
        case_id=case.id,
        case_revision_id=case.current_revision_id,
        class_id=klass.id,
        teacher_id=teacher.id,
        title="第三章 病史采集",
        description=description,
        features={"emotion": True},
        behavior=behavior or {"mode": "guided"},
        audience_mode="class" if len(recipients) > 1 else "selected",
        start_time=now + timedelta(seconds=start_offset),
        end_time=now + timedelta(seconds=end_offset),
        is_closed=is_closed,
        max_attempts=max_attempts,
    )
    pg_session.add(assignment)
    pg_session.flush()
    if max_attempts is None:
        # 列默认值为 1；显式 NULL 表示「不限制」，需在 flush 后覆盖才能落到库里
        assignment.max_attempts = None
        pg_session.flush()
    for user in recipients:
        pg_session.add(AssignmentRecipient(assignment_id=assignment.id, user_id=user.id))
    pg_session.flush()
    return assignment


def _record(pg_session, *, user, case, assignment, status="completed", score: float | None = None, scoring_status=None):
    now = datetime.now(UTC)
    record = TrainingRecord(
        user_id=user.id,
        case_id=case.id,
        case_revision_id=case.current_revision_id,
        assignment_id=assignment.id,
        status=status,
        scoring_status=scoring_status,
        start_time=now - timedelta(minutes=30),
        end_time=now if status == "completed" else None,
        is_student_practice=True,
        case_snapshot=CASE_DATA,
    )
    pg_session.add(record)
    pg_session.flush()
    if score is not None:
        pg_session.add(Score(record_id=record.id, total_score=score))
        pg_session.flush()
    return record


@pytest.fixture
def client(pg_session):
    """把真实 DB 会话与被测学生注入依赖覆盖；返回构造器便于按需换身份。"""

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


def test_student_reads_own_assignment_with_all_attempts(pg_session, client):
    school = ensure_school(pg_session)
    teacher = make_user(pg_session, school=school, personas=("teacher",), display_name="王老师")
    student = make_user(pg_session, school=school, display_name="李同学")
    klass = _class(pg_session, school)
    _member(pg_session, student, klass)
    case = _case(pg_session, school)
    assignment = _assignment(pg_session, case=case, klass=klass, teacher=teacher, recipients=[student], max_attempts=3)
    _record(pg_session, user=student, case=case, assignment=assignment, score=81.5, scoring_status="completed")
    _record(pg_session, user=student, case=case, assignment=assignment, score=64.0, scoring_status="completed")

    resp = client(student).get(f"/api/students/assignments/{assignment.id}")

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["title"] == "第三章 病史采集"
    assert body["description"] == "请按护理程序完成完整病史采集。"
    assert body["case_name"] == "社区获得性肺炎"
    assert body["class_name"] == "护理2401"
    assert body["teacher_name"] == "王老师"
    assert body["mode"] == "guided"
    assert body["hide_case_info"] is False
    assert body["lifecycle"] == "active"
    assert body["status"] == "completed"
    assert body["max_attempts"] == 3
    assert body["attempt_count"] == 2
    assert body["remaining_attempts"] == 1
    # 全部尝试都在（不是只给代表记录）
    assert len(body["attempts"]) == 2
    assert all(a["status"] == "completed" for a in body["attempts"])
    assert sorted(a["score_total"] for a in body["attempts"]) == [64.0, 81.5]
    assert all(a["record_id"] for a in body["attempts"])
    # 分数口径 = 代表记录 = 完成组里最高分
    assert body["record_id"] in {a["record_id"] for a in body["attempts"]}


def test_non_member_student_gets_404(pg_session, client):
    school = ensure_school(pg_session)
    teacher = make_user(pg_session, school=school, personas=("teacher",))
    outsider = make_user(pg_session, school=school)
    klass = _class(pg_session, school)
    case = _case(pg_session, school)
    assignment = _assignment(pg_session, case=case, klass=klass, teacher=teacher, recipients=[outsider])

    resp = client(outsider).get(f"/api/students/assignments/{assignment.id}")

    assert resp.status_code == 404, resp.text


def test_class_member_outside_audience_gets_404(pg_session, client):
    """成员但不在发布受众快照内（指定名单没他）→ 不可访问。"""
    school = ensure_school(pg_session)
    teacher = make_user(pg_session, school=school, personas=("teacher",))
    chosen = make_user(pg_session, school=school)
    other = make_user(pg_session, school=school)
    klass = _class(pg_session, school)
    _member(pg_session, chosen, klass)
    _member(pg_session, other, klass)
    case = _case(pg_session, school)
    assignment = _assignment(pg_session, case=case, klass=klass, teacher=teacher, recipients=[chosen])

    assert client(other).get(f"/api/students/assignments/{assignment.id}").status_code == 404
    assert client(chosen).get(f"/api/students/assignments/{assignment.id}").status_code == 200


def test_teacher_without_assignment_manage_role_can_read_own_assignment(pg_session, client):
    """学生路径不借用 ``assignment_manage``：角色只有 student 也读得到自己的作业。"""
    school = ensure_school(pg_session)
    teacher = make_user(pg_session, school=school, personas=("teacher",))
    student = make_user(pg_session, school=school, personas=("student",))
    klass = _class(pg_session, school)
    _member(pg_session, student, klass)
    case = _case(pg_session, school)
    assignment = _assignment(pg_session, case=case, klass=klass, teacher=teacher, recipients=[student])

    assert not student.has_permission("assignment_manage")
    assert client(student).get(f"/api/students/assignments/{assignment.id}").status_code == 200


def test_hidden_case_assignment_does_not_leak_case_name(pg_session, client):
    school = ensure_school(pg_session)
    teacher = make_user(pg_session, school=school, personas=("teacher",))
    student = make_user(pg_session, school=school)
    klass = _class(pg_session, school)
    _member(pg_session, student, klass)
    case = _case(pg_session, school)
    assignment = _assignment(
        pg_session,
        case=case,
        klass=klass,
        teacher=teacher,
        recipients=[student],
        behavior={"mode": "assessment", "hide_case_info": True},
    )

    body = client(student).get(f"/api/students/assignments/{assignment.id}").json()

    assert body["hide_case_info"] is True
    assert body["case_name"] == ""
    assert body["mode"] == "assessment"


def test_closed_assignment_still_exposes_full_history(pg_session, client):
    """关闭后仍可看历史：状态变 closed，attempts 不缩水。"""
    school = ensure_school(pg_session)
    teacher = make_user(pg_session, school=school, personas=("teacher",))
    student = make_user(pg_session, school=school)
    klass = _class(pg_session, school)
    _member(pg_session, student, klass)
    case = _case(pg_session, school)
    assignment = _assignment(pg_session, case=case, klass=klass, teacher=teacher, recipients=[student], is_closed=True)
    _record(pg_session, user=student, case=case, assignment=assignment, score=70.0, scoring_status="completed")

    body = client(student).get(f"/api/students/assignments/{assignment.id}").json()

    assert body["lifecycle"] == "closed"
    assert body["status"] == "closed"
    assert len(body["attempts"]) == 1
    assert body["attempts"][0]["score_total"] == 70.0


def test_ended_assignment_reports_ended_lifecycle(pg_session, client):
    school = ensure_school(pg_session)
    teacher = make_user(pg_session, school=school, personas=("teacher",))
    student = make_user(pg_session, school=school)
    klass = _class(pg_session, school)
    _member(pg_session, student, klass)
    case = _case(pg_session, school)
    assignment = _assignment(
        pg_session, case=case, klass=klass, teacher=teacher, recipients=[student], start_offset=-7200, end_offset=-3600
    )

    body = client(student).get(f"/api/students/assignments/{assignment.id}").json()

    assert body["lifecycle"] == "ended"
    assert body["attempts"] == []


def test_no_attempts_yields_empty_list_and_full_quota(pg_session, client):
    school = ensure_school(pg_session)
    teacher = make_user(pg_session, school=school, personas=("teacher",))
    student = make_user(pg_session, school=school)
    klass = _class(pg_session, school)
    _member(pg_session, student, klass)
    case = _case(pg_session, school)
    assignment = _assignment(pg_session, case=case, klass=klass, teacher=teacher, recipients=[student], max_attempts=2)

    body = client(student).get(f"/api/students/assignments/{assignment.id}").json()

    assert body["attempts"] == []
    assert body["status"] == "not_started"
    assert body["record_id"] is None
    assert body["attempt_count"] == 0
    assert body["remaining_attempts"] == 2


def test_in_progress_attempt_exposes_resumable_record_but_no_score(pg_session, client):
    """进行中：给出 record_id 供继续；不算已用次数；不出分。"""
    school = ensure_school(pg_session)
    teacher = make_user(pg_session, school=school, personas=("teacher",))
    student = make_user(pg_session, school=school)
    klass = _class(pg_session, school)
    _member(pg_session, student, klass)
    case = _case(pg_session, school)
    assignment = _assignment(pg_session, case=case, klass=klass, teacher=teacher, recipients=[student], max_attempts=1)
    record = _record(pg_session, user=student, case=case, assignment=assignment, status="in_progress")

    body = client(student).get(f"/api/students/assignments/{assignment.id}").json()

    assert body["status"] == "in_progress"
    assert body["record_id"] == record.id
    assert body["attempts"] == [
        {
            "record_id": record.id,
            "status": "in_progress",
            "scoring_status": None,
            "score_total": None,
            "is_overdue": False,
            "start_time": body["attempts"][0]["start_time"],
            "end_time": None,
        }
    ]
    assert body["attempt_count"] == 0
    assert body["remaining_attempts"] == 1


def test_unlimited_attempts_reports_none_remaining(pg_session, client):
    school = ensure_school(pg_session)
    teacher = make_user(pg_session, school=school, personas=("teacher",))
    student = make_user(pg_session, school=school)
    klass = _class(pg_session, school)
    _member(pg_session, student, klass)
    case = _case(pg_session, school)
    assignment = _assignment(
        pg_session, case=case, klass=klass, teacher=teacher, recipients=[student], max_attempts=None
    )

    body = client(student).get(f"/api/students/assignments/{assignment.id}").json()

    assert body["max_attempts"] is None
    assert body["remaining_attempts"] is None


def test_long_description_is_returned_verbatim(pg_session, client):
    school = ensure_school(pg_session)
    teacher = make_user(pg_session, school=school, personas=("teacher",))
    student = make_user(pg_session, school=school)
    klass = _class(pg_session, school)
    _member(pg_session, student, klass)
    case = _case(pg_session, school)
    assignment = _assignment(
        pg_session, case=case, klass=klass, teacher=teacher, recipients=[student], description=LONG_DESCRIPTION
    )

    body = client(student).get(f"/api/students/assignments/{assignment.id}").json()

    assert body["description"] == LONG_DESCRIPTION


def test_unknown_assignment_id_is_404(pg_session, client):
    school = ensure_school(pg_session)
    student = make_user(pg_session, school=school)

    assert client(student).get("/api/students/assignments/does-not-exist").status_code == 404


# ── 公开训练要求：预计时限 / 要做的操作 / 必交产物 ──
#
# 三件事都来自已有声明（病例列、病例 activities、completion.required_artifacts），
# 这里只锁「学生看到什么」，不锁投影实现。

CASE_WITH_ACTIVITIES = {
    **CASE_DATA,
    "activities": {
        "physical_exam": {"config": {"vital_signs": {"temperature": "37.2-37.8"}}},
        "nursing_record": {"config": {"fields": ["chief_complaint"]}},
    },
}


def test_requirements_expose_time_limit_from_case(pg_session, client):
    school = ensure_school(pg_session)
    teacher = make_user(pg_session, school=school, personas=("teacher",))
    student = make_user(pg_session, school=school)
    klass = _class(pg_session, school)
    _member(pg_session, student, klass)
    case = _case(pg_session, school, time_limit_minutes=45)
    assignment = _assignment(pg_session, case=case, klass=klass, teacher=teacher, recipients=[student])

    body = client(student).get(f"/api/students/assignments/{assignment.id}").json()

    assert body["time_limit_minutes"] == 45


def test_requirements_expose_configured_activities_with_public_labels(pg_session, client):
    school = ensure_school(pg_session)
    teacher = make_user(pg_session, school=school, personas=("teacher",))
    student = make_user(pg_session, school=school)
    klass = _class(pg_session, school)
    _member(pg_session, student, klass)
    case = _case(pg_session, school, content=CASE_WITH_ACTIVITIES)
    assignment = _assignment(pg_session, case=case, klass=klass, teacher=teacher, recipients=[student])

    body = client(student).get(f"/api/students/assignments/{assignment.id}").json()

    labels = {item["id"]: item["label"] for item in body["required_activities"]}
    # 标签来自 Activity 登记表；只投影 id + label，不带 config
    assert labels == {"physical_exam": "床旁检查", "nursing_record": "护理记录"}
    assert all(set(item) == {"id", "label"} for item in body["required_activities"])


def test_case_without_declared_activities_reports_no_required_activities(pg_session, client):
    """病例没声明任何 activity → 不要求学生做右侧面板操作（而不是塞一堆默认值）。"""
    school = ensure_school(pg_session)
    teacher = make_user(pg_session, school=school, personas=("teacher",))
    student = make_user(pg_session, school=school)
    klass = _class(pg_session, school)
    _member(pg_session, student, klass)
    case = _case(pg_session, school)
    assignment = _assignment(pg_session, case=case, klass=klass, teacher=teacher, recipients=[student])

    body = client(student).get(f"/api/students/assignments/{assignment.id}").json()

    assert body["required_activities"] == []


def test_no_extra_required_artifacts_is_reported_explicitly(pg_session, client):
    """history_taking 默认不设交卷门禁 → 空列表（页面据此显示「无额外必交」）。"""
    school = ensure_school(pg_session)
    teacher = make_user(pg_session, school=school, personas=("teacher",))
    student = make_user(pg_session, school=school)
    klass = _class(pg_session, school)
    _member(pg_session, student, klass)
    case = _case(pg_session, school, content=CASE_WITH_ACTIVITIES)
    assignment = _assignment(pg_session, case=case, klass=klass, teacher=teacher, recipients=[student])

    body = client(student).get(f"/api/students/assignments/{assignment.id}").json()

    assert body["required_artifacts"] == []


def test_case_declared_completion_artifact_is_exposed_with_label(pg_session, client):
    """病例显式声明 completion.required_artifacts → 学生看到必交项与它的公开标签。"""
    school = ensure_school(pg_session)
    teacher = make_user(pg_session, school=school, personas=("teacher",))
    student = make_user(pg_session, school=school)
    klass = _class(pg_session, school)
    _member(pg_session, student, klass)
    case = _case(
        pg_session,
        school,
        content={**CASE_WITH_ACTIVITIES, "completion": {"required_artifacts": ["nursing_record"]}},
    )
    assignment = _assignment(pg_session, case=case, klass=klass, teacher=teacher, recipients=[student])

    body = client(student).get(f"/api/students/assignments/{assignment.id}").json()

    assert body["required_artifacts"] == [{"kind": "nursing_record", "label": "护理记录"}]


def test_requirements_do_not_leak_teacher_side_content(pg_session, client):
    """hidden_info / 评分细则 / activity config 不得出现在学生响应里。"""
    school = ensure_school(pg_session)
    teacher = make_user(pg_session, school=school, personas=("teacher",))
    student = make_user(pg_session, school=school)
    klass = _class(pg_session, school)
    _member(pg_session, student, klass)
    case = _case(
        pg_session,
        school,
        content={
            **CASE_WITH_ACTIVITIES,
            "hidden_info": ["真实诊断：肺炎链球菌感染", "不要告诉学生"],
            "completion": {"required_artifacts": ["nursing_record"]},
        },
    )
    assignment = _assignment(pg_session, case=case, klass=klass, teacher=teacher, recipients=[student])

    raw = client(student).get(f"/api/students/assignments/{assignment.id}").text

    assert "真实诊断" not in raw
    assert "不要告诉学生" not in raw
    assert "vital_signs" not in raw  # activity config 属运行期材料，不投影给学生


def test_assignment_behavior_time_limit_overrides_case(pg_session, client):
    """作业上的 behavior.time_limit_minutes 覆盖病例列（与开始训练同一取数顺序）。"""
    school = ensure_school(pg_session)
    teacher = make_user(pg_session, school=school, personas=("teacher",))
    student = make_user(pg_session, school=school)
    klass = _class(pg_session, school)
    _member(pg_session, student, klass)
    case = _case(pg_session, school, time_limit_minutes=30)
    assignment = _assignment(
        pg_session,
        case=case,
        klass=klass,
        teacher=teacher,
        recipients=[student],
        behavior={"mode": "assessment", "time_limit_minutes": 60},
    )

    body = client(student).get(f"/api/students/assignments/{assignment.id}").json()

    assert body["time_limit_minutes"] == 60
