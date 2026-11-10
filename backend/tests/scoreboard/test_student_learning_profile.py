"""学生学习档案（GET /api/scoreboard/students/{id}/profile）。

验收锁定在**响应体对外契约**上，不镜像服务层实现：

① 教师（只有 ``assignment_manage``，没有 ``user_manage``）能读到该生的趋势 + 作业 + 训练记录；
② 趋势与 ``/students/{id}/trend`` 是同一组点、同一份可比性结论（不复制口径）；
③ 作业进度用受众快照 + 代表记录口径（未开始 = ``not_started``，``record_id`` 为空）；
④ 训练记录与教师记录列表同口径：复核分优先、兜底分不计入；
⑤ 无任何训练的学生也能打开档案（空趋势、空作业、空训练，不报错）；
⑥ 跨院校学生一律 404（存在性也不暴露）；
⑦ 响应不含账号/安全字段（邮箱、微信、锁定、权限/视角授予）。
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
    Assignment,
    AssignmentRecipient,
    Case,
    CaseRevision,
    Class,
    ClassMembership,
    School,
    Score,
    ScoreReview,
    TrainingRecord,
    User,
    UserSchoolPersona,
)

NOW = datetime.now(UTC)
CASE_DATA = {"name": "社区获得性肺炎", "patient_info": {"name": "张伟"}, "chief_complaint": "咳嗽三天"}

# 账号/安全面：档案响应里一个都不许出现
FORBIDDEN_IDENTITY_KEYS = {
    "email",
    "wechat_openid",
    "is_active",
    "is_platform",
    "token_version",
    "locked_until",
    "failed_login_count",
    "last_login_at",
    "personas",
    "permissions",
    "roles",
    "password_hash",
}


def _school(db, name: str) -> School:
    school = School(name=name, created_at=NOW)
    db.add(school)
    db.flush()
    return school


def _person(db, username: str, school: School, persona: str, **fields) -> User:
    user = User(
        username=username,
        password_hash="x",
        display_name=fields.pop("display_name", username),
        school_id=school.id,
        created_at=NOW,
        updated_at=NOW,
        **fields,
    )
    db.add(user)
    db.flush()
    db.add(UserSchoolPersona(user_id=user.id, school_id=school.id, persona=persona))
    db.flush()
    user.set_active_persona(persona)
    user.set_permissions_cache(set(persona_permissions(persona)))
    clear_access_cache()
    return user


def _class(db, school: School, name: str) -> Class:
    klass = Class(name=name, cohort_label="2026级", school_id=school.id, created_at=NOW)
    db.add(klass)
    db.flush()
    return klass


def _join(db, user: User, klass: Class, role: str = "student") -> None:
    db.add(ClassMembership(user_id=user.id, class_id=klass.id, member_role=role, joined_at=NOW))
    db.flush()


def _case(db) -> Case:
    case = Case(name="社区获得性肺炎", description="", case_data=CASE_DATA, is_open=True, status="published")
    db.add(case)
    db.flush()
    revision = CaseRevision(case_id=case.id, revision_no=1, content=CASE_DATA, created_by=None)
    db.add(revision)
    db.flush()
    case.current_revision_id = revision.id
    db.flush()
    return case


def _assignment(db, *, case: Case, klass: Class, teacher: User, students: list[User], **overrides) -> Assignment:
    assignment = Assignment(
        case_id=case.id,
        case_revision_id=case.current_revision_id,
        class_id=klass.id,
        teacher_id=teacher.id,
        title=overrides.pop("title", "第三章 病史采集"),
        description=None,
        features={},
        behavior={},
        audience_mode="class",
        start_time=NOW - timedelta(days=2),
        end_time=overrides.pop("end_time", NOW + timedelta(days=2)),
        is_closed=overrides.pop("is_closed", False),
        max_attempts=overrides.pop("max_attempts", 2),
    )
    db.add(assignment)
    db.flush()
    for student in students:
        db.add(AssignmentRecipient(assignment_id=assignment.id, user_id=student.id))
    db.flush()
    return assignment


def _record(
    db,
    *,
    student: User,
    case: Case,
    assignment: Assignment | None = None,
    status: str = "completed",
    scoring_status: str | None = "completed",
    total: float | None = None,
    reviewed: float | None = None,
    fallback: dict | None = None,
    hours_ago: int = 1,
) -> TrainingRecord:
    start = NOW - timedelta(hours=hours_ago)
    record = TrainingRecord(
        user_id=student.id,
        case_id=case.id,
        case_revision_id=case.current_revision_id,
        assignment_id=assignment.id if assignment else None,
        status=status,
        scoring_status=scoring_status,
        start_time=start,
        end_time=start + timedelta(minutes=25) if status == "completed" else None,
        is_student_practice=True,
        case_snapshot=CASE_DATA,
    )
    db.add(record)
    db.flush()
    if total is not None:
        db.add(Score(record_id=record.id, total_score=total, reviewed_total=reviewed, fallback=fallback))
        db.flush()
    return record


@pytest.fixture
def world(pg_session):
    db = pg_session
    school_a = _school(db, "甲大学")
    school_b = _school(db, "乙学院")
    teacher = _person(db, "teacher-a", school_a, "teacher", display_name="王老师")
    class_a = _class(db, school_a, "护理2401")
    class_b = _class(db, school_b, "护理2402")
    _join(db, teacher, class_a, "teacher")

    # 长姓名 + 显式学号：移动端/截断场景要靠真实数据驱动，不靠断言长度
    student = _person(
        db,
        "stu-a",
        school_a,
        "student",
        display_name="欧阳娜娜·阿不都热合曼·艾力",
        student_id="2024010101",
        email="stu@example.com",
    )
    outsider = _person(db, "stu-b", school_b, "student", display_name="乙校学生")
    _join(db, student, class_a)
    _join(db, outsider, class_b)

    case = _case(db)
    assignment = _assignment(db, case=case, klass=class_a, teacher=teacher, students=[student])
    return {
        "db": db,
        "school_a": school_a,
        "school_b": school_b,
        "teacher": teacher,
        "student": student,
        "outsider": outsider,
        "class_a": class_a,
        "case": case,
        "assignment": assignment,
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


def _profile(client, student_id: int, **params):
    return client.get(f"/api/scoreboard/students/{student_id}/profile", params=params)


def test_same_school_non_student_target_is_404(world, client):
    """校级教师不能按 user_id 遍历同校管理员/教师的账号信息。"""
    admin = _person(world["db"], "admin-a", world["school_a"], "admin")
    resp = _profile(client(world["teacher"]), admin.id)
    assert resp.status_code == 404


def test_class_filter_rejects_student_outside_that_class(world, client):
    """班级筛选是上下文，不是仅给趋势用的装饰：目标不在班内时整份档案 404。"""
    other_class = _class(world["db"], world["school_a"], "护理2402")
    resp = _profile(
        client(world["teacher"]),
        world["student"].id,
        class_id=other_class.id,
        include_free=True,
    )
    assert resp.status_code == 404


def test_teacher_reads_profile_without_user_manage(world, client):
    """只有 ``assignment_manage`` 的教师能读：档案用的是成绩管理那道门。"""
    teacher = world["teacher"]
    assert teacher.has_permission("assignment_manage")
    assert not teacher.has_permission("user_manage")

    resp = _profile(client(teacher), world["student"].id, include_free=True)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["student"]["user_id"] == world["student"].id
    assert body["student"]["display_name"] == world["student"].display_name
    assert body["student"]["student_id"] == "2024010101"
    assert [c["name"] for c in body["student"]["classes"]] == ["护理2401"]


def test_profile_hides_account_and_security_fields(world, client):
    _record(world["db"], student=world["student"], case=world["case"], assignment=world["assignment"], total=81.0)
    body = _profile(client(world["teacher"]), world["student"].id, include_free=True).json()
    assert FORBIDDEN_IDENTITY_KEYS.isdisjoint(body["student"])

    # 递归检查：嵌套块（趋势/作业/训练）也不得夹带账号面字段
    def walk(node):
        if isinstance(node, dict):
            assert FORBIDDEN_IDENTITY_KEYS.isdisjoint(node)
            for value in node.values():
                walk(value)
        elif isinstance(node, list):
            for value in node:
                walk(value)

    walk(body)


def test_trend_block_matches_trend_endpoint(world, client):
    """档案里的趋势与排行榜弹窗的查询是同一份：同参数必须同结果。"""
    db = world["db"]
    for i, score in enumerate((70.0, 78.0, 86.0), start=1):
        _record(
            db,
            student=world["student"],
            case=world["case"],
            assignment=world["assignment"],
            total=score,
            hours_ago=10 - i,
        )
    http = client(world["teacher"])
    profile = _profile(http, world["student"].id).json()
    trend = http.get(
        f"/api/scoreboard/students/{world['student'].id}/trend",
        params={"include_free": False},
    ).json()
    assert profile["trend"] == trend
    assert profile["trend"]["training_count"] == 3
    assert [r["score"] for r in profile["trend"]["records"]] == [70.0, 78.0, 86.0]


def test_assignment_progress_uses_recipient_snapshot_and_representative(world, client):
    db = world["db"]
    assignment = world["assignment"]
    # 作业只有一条 in_progress：进度 = in_progress，尝试次数不计入进行中
    _record(
        db,
        student=world["student"],
        case=world["case"],
        assignment=assignment,
        status="in_progress",
        scoring_status=None,
    )
    body = _profile(client(world["teacher"]), world["student"].id, include_free=True).json()
    (item,) = body["assignments"]
    assert item["assignment_id"] == assignment.id
    assert item["status"] == "in_progress"
    assert item["attempt_count"] == 0
    assert item["record_id"] is not None

    # 再补一条已完成且有分：代表记录换成已完成的那条，分数取有效分
    done = _record(
        db,
        student=world["student"],
        case=world["case"],
        assignment=assignment,
        total=64.0,
        reviewed=88.5,
        hours_ago=3,
    )
    body = _profile(client(world["teacher"]), world["student"].id, include_free=True).json()
    (item,) = body["assignments"]
    assert item["status"] == "completed"
    assert item["record_id"] == done.id
    assert item["score_total"] == 88.5
    assert item["attempt_count"] == 1
    assert item["max_attempts"] == 2


def test_assignment_not_started_has_no_record(world, client):
    body = _profile(client(world["teacher"]), world["student"].id, include_free=True).json()
    (item,) = body["assignments"]
    assert item["status"] == "not_started"
    assert item["record_id"] is None
    assert item["score_total"] is None
    assert item["attempt_count"] == 0


def test_training_records_follow_teacher_record_grade_scope(world, client):
    """复核分优先、兜底分不计入 —— 与教师记录列表同一份成绩口径。"""
    db = world["db"]
    reviewed = _record(db, student=world["student"], case=world["case"], total=70.0, reviewed=92.0, hours_ago=1)
    db.add(ScoreReview(score_id=reviewed.score.id, total_score=92.0, detail_scores={}))
    degraded = _record(
        db,
        student=world["student"],
        case=world["case"],
        total=55.0,
        fallback={"kind": "timeout", "note": "评分超时"},
        hours_ago=2,
    )
    _record(db, student=world["student"], case=world["case"], status="abandoned", scoring_status=None, hours_ago=3)

    body = _profile(client(world["teacher"]), world["student"].id, include_free=True).json()
    by_id = {r["record_id"]: r for r in body["training"]}
    assert by_id[reviewed.id]["score_total"] == 92.0
    assert by_id[reviewed.id]["score_source"] == "review"
    assert by_id[reviewed.id]["score_reviewed"] is True
    assert by_id[degraded.id]["score_total"] is None, "兜底分不得作为成绩展示"
    assert by_id[degraded.id]["score_degraded"] is True
    assert body["training_total"] == 3
    # 汇总只算已完成且非兜底：一条复核分
    assert body["training_summary"]["completed"] == 2
    assert body["training_summary"]["scored"] == 1
    assert body["training_summary"]["avg_score"] == 92.0


def test_training_pagination_and_status_filter(world, client):
    db = world["db"]
    for hours in range(1, 6):
        _record(db, student=world["student"], case=world["case"], total=60.0 + hours, hours_ago=hours)
    http = client(world["teacher"])
    page = _profile(http, world["student"].id, training_limit=2, training_offset=0, include_free=True).json()
    assert len(page["training"]) == 2
    assert page["training_total"] == 5
    assert page["training_limit"] == 2

    abandoned = _record(
        db, student=world["student"], case=world["case"], status="abandoned", scoring_status=None, hours_ago=9
    )
    filtered = _profile(http, world["student"].id, training_status="abandoned", include_free=True).json()
    assert [r["record_id"] for r in filtered["training"]] == [abandoned.id]
    assert filtered["training_total"] == 1


def test_student_without_any_training_still_renders(world, client):
    """无训练学生：档案 200，三块都空，不是错误页。"""
    body = _profile(client(world["teacher"]), world["student"].id, include_free=True).json()
    assert body["trend"]["training_count"] == 0
    assert body["trend"]["records"] == []
    assert body["trend"]["avg_score"] is None
    assert body["training"] == []
    assert body["training_total"] == 0
    assert body["training_summary"]["scored"] == 0


def test_cross_school_student_is_404(world, client):
    """跨院校一律 404：教师不能借档案读取别校学生（连存在性都不暴露）。"""
    _record(world["db"], student=world["outsider"], case=world["case"], total=90.0)
    resp = _profile(client(world["teacher"]), world["outsider"].id)
    assert resp.status_code == 404
    assert resp.json()["detail"] == "学生不存在"


def test_unknown_student_is_404(world, client):
    resp = _profile(client(world["teacher"]), 999_999)
    assert resp.status_code == 404


def test_score_review_only_permission_is_not_enough(pg_session, client):
    """没有 ``assignment_manage`` 的学生不能读他人的档案（403，不是 404 冒充）。"""
    db = pg_session
    school = _school(db, "丙学院")
    klass = _class(db, school, "护理2403")
    viewer = _person(db, "stu-viewer", school, "student")
    target = _person(db, "stu-target", school, "student")
    _join(db, viewer, klass)
    _join(db, target, klass)

    resp = _profile(client(viewer), target.id)
    assert resp.status_code == 403
