import pytest
from sqlalchemy import Integer, String, create_engine
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, sessionmaker

from core.exceptions import NotFoundError
from repositories.base import Repository


class _Base(DeclarativeBase):
    pass


class _Widget(_Base):
    __tablename__ = "widgets"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(40))


class _WidgetRepo(Repository[_Widget]):
    model = _Widget


@pytest.fixture
def db():
    engine = create_engine("sqlite://")
    _Base.metadata.create_all(engine)
    s = sessionmaker(bind=engine)()
    yield s
    s.close()


def test_add_get_exists_delete(db):
    repo = _WidgetRepo(db)
    w = repo.add(_Widget(name="a"))
    db.commit()
    assert repo.get(w.id).name == "a"
    assert repo.exists(_Widget.name == "a") is True
    assert repo.exists(_Widget.name == "zzz") is False
    repo.delete(w)
    db.commit()
    assert repo.get(w.id) is None


def test_get_or_404_raises(db):
    repo = _WidgetRepo(db)
    with pytest.raises(NotFoundError):
        repo.get_or_404(999, "没有")
