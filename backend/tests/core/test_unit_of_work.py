import pytest
from sqlalchemy.exc import IntegrityError

from core.exceptions import ConflictError
from core.unit_of_work import unit_of_work


class _FakeSession:
    def __init__(self):
        self.committed = False
        self.rolled_back = False

    def commit(self):
        self.committed = True

    def rollback(self):
        self.rolled_back = True


def test_commits_on_success():
    db = _FakeSession()
    with unit_of_work(db):
        pass
    assert db.committed
    assert not db.rolled_back


def test_rolls_back_and_reraises_on_error():
    db = _FakeSession()
    with pytest.raises(RuntimeError), unit_of_work(db):
        raise RuntimeError("boom")
    assert db.rolled_back
    assert not db.committed


def test_maps_integrity_error_to_conflict():
    db = _FakeSession()
    with pytest.raises(ConflictError), unit_of_work(db, conflict_detail="dup"):
        raise IntegrityError("stmt", {}, Exception("orig"))
    assert db.rolled_back
