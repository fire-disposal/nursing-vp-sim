import pytest

from core.exceptions import NotFoundError, ValidationError
from services.grade import GradeService

SCHOOL_ID = 1  # conftest 已插入 id=1 的默认学校


def test_create_list_update(db_session):
    svc = GradeService(db_session)
    v = svc.create("2024级", school_id=SCHOOL_ID)
    assert v.name == "2024级"
    assert v.class_count == 0
    assert any(g.name == "2024级" for g in svc.list())
    v2 = svc.update(v.id, "2025级")
    assert v2.name == "2025级"


def test_create_duplicate_raises_validation(db_session):
    svc = GradeService(db_session)
    svc.create("重复级", school_id=SCHOOL_ID)
    with pytest.raises(ValidationError):
        svc.create("重复级", school_id=SCHOOL_ID)


def test_update_missing_raises_not_found(db_session):
    svc = GradeService(db_session)
    with pytest.raises(NotFoundError):
        svc.update(99999, "x")


def test_delete_empty_grade(db_session):
    svc = GradeService(db_session)
    v = svc.create("待删级", school_id=SCHOOL_ID)
    assert svc.delete(v.id) == 0
