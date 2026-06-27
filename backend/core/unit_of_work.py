"""Transactional unit-of-work for the request path.

Wrap a mutation block: commit on success; on failure roll back and map
DB integrity violations to a ConflictError (409) so handlers stay clean.
"""

from collections.abc import Iterator
from contextlib import contextmanager

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from core.exceptions import ConflictError


@contextmanager
def unit_of_work(db: Session, *, conflict_detail: str = "资源冲突") -> Iterator[Session]:
    try:
        yield db
        db.commit()
    except IntegrityError as e:
        db.rollback()
        raise ConflictError(conflict_detail) from e
    except Exception:
        db.rollback()
        raise
