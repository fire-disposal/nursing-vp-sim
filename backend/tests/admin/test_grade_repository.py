from models import Grade
from repositories.grade import GradeRepository


def test_name_exists_and_counts(db_session):
    repo = GradeRepository(db_session)

    g = repo.add(Grade(name="2024级", school_id=1))
    db_session.commit()
    assert repo.name_exists("2024级") is True
    assert repo.name_exists("2024级", exclude_id=g.id) is False
    assert repo.name_exists("不存在") is False
    assert repo.class_counts([g.id]) == {}
    assert repo.list_ordered()[0].name == "2024级"
