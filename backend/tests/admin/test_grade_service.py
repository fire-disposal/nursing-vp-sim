"""Grade CRUD tests — exercises GradeService public API."""

import pytest

from core.exceptions import ValidationError
from modules.admin.grades import GradeService


def test_create_and_list(db_session):
    svc = GradeService(db_session)
    view = svc.create("2024级")
    assert view.name == "2024级"

    all_grades = svc.list_all()
    names = [g.name for g in all_grades]
    assert "2024级" in names


def test_duplicate_name_rejected(db_session):
    svc = GradeService(db_session)
    svc.create("2024级")
    with pytest.raises(ValidationError):
        svc.create("2024级")


def test_update_rename(db_session):
    svc = GradeService(db_session)
    view = svc.create("2024级")
    updated = svc.update(view.id, "2025级")
    assert updated.name == "2025级"


pytestmark = pytest.mark.integration
