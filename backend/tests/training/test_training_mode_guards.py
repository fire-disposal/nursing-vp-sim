import pytest
from fastapi import HTTPException

from models import Message, TrainingRecord
from modules.training.router.chat import _ensure_correction_allowed


def test_assessment_mode_rejects_message_correction_before_mutation_checks():
    record = TrainingRecord(
        id=7,
        status="in_progress",
        practice_snapshot={"behavior": {"mode": "assessment"}},
    )

    with pytest.raises(HTTPException, match="独立考核不允许修正") as exc_info:
        _ensure_correction_allowed(None, record, Message())  # type: ignore[arg-type]

    assert exc_info.value.status_code == 400
