"""PydanticJSONB — typed JSONB column with write-guard validation for SQLAlchemy.

Applies uniformly to any payload: validates on write (clean dict into DB),
passes raw dict on read (backward-compatible with existing dict-access code).

Usage:
    class MyPayload(JsonbModel):
        ...

    class MyModel(Base):
        data: Mapped[dict] = mapped_column(PydanticJSONB(MyPayload))
"""

import logging

from pydantic import BaseModel, ConfigDict
from sqlalchemy.dialects.postgresql import JSONB as DBJSONB
from sqlalchemy.types import TypeDecorator

_log = logging.getLogger(__name__)


class JsonbModel(BaseModel):
    """Pydantic base for JSONB payloads.

    ``extra="ignore"`` ensures payload evolution is non-destructive — unknown
    keys from older data are silently dropped on validation rather than
    raising.  Every field should carry a default so reads of historical rows
    never fail.
    """

    model_config = ConfigDict(extra="ignore")


class PydanticJSONB(TypeDecorator):
    """SQLAlchemy column adapter: validates on write, transparent on read.

    ``process_bind_param`` validates incoming data through the Pydantic
    *model* and stores the cleaned dict.  ``process_result_value`` returns
    the raw dict unchanged — existing code that accesses ``case.case_data``
    as a dict continues to work without rework.
    """

    impl = DBJSONB  #  underlying DB storage is unchanged
    cache_ok = True

    def __init__(self, model: type[JsonbModel]):
        super().__init__()
        self._model = model

    def process_bind_param(self, value, dialect):
        if value is None:
            return None
        if isinstance(value, self._model):
            return value.model_dump(mode="json")
        try:
            return self._model.model_validate(value).model_dump(mode="json")
        except Exception:
            # Read-loose policy: log the problem, store whatever was given.
            # Strict enforcement is done at the route level (validate_case_data,
            # strict=True).  The column-level guard is advisory — catches and
            # reports issues without blocking existing write paths.
            _log.warning(
                "%s validation failed — storing raw value as-is",
                self._model.__name__,
                exc_info=True,
            )
            return value

    def process_result_value(self, value, dialect):
        """Pass-through — keep the raw dict so no existing ``.get("key")`` call breaks."""
        return value
