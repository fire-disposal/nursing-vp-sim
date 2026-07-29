"""Integration test: pipeline produces same result as existing flow."""

from unittest.mock import AsyncMock, MagicMock

import pytest

from modules.training.pipeline import PipelineContext, get_pipeline, run_pipeline


@pytest.mark.asyncio
async def test_pipeline_without_operation_passes_to_llm_caller():
    """Normal chat message flows through to LLM without short-circuit."""
    record = MagicMock()
    record.id = 1
    record.user_id = 1
    record.case_id = 1
    record.training_type = "history_taking"
    record.practice_snapshot = {"features": {}}

    user = MagicMock()
    user.id = 1

    db = MagicMock()

    app_state = MagicMock()
    app_state.httpx_client = MagicMock()
    app_state.llm_router = MagicMock()
    app_state.log_worker = MagicMock()
    mock_llm_client2 = MagicMock()
    mock_llm_client2.call = AsyncMock(return_value="mock reply")
    mock_llm_client2.call_json = AsyncMock(return_value={})
    mock_llm_client2.stream = AsyncMock()
    app_state.llm_client = mock_llm_client2

    case_data = {
        "patient_info": {"name": "test", "age": 30, "gender": "男"},
        "scenario": "test",
        "personality": {},
        "communication_style": "温和",
        "chief_complaint": "头痛",
        "present_illness": "",
        "past_history": "",
        "medication_history": "",
        "allergy_history": "",
        "family_history": "",
        "social_history": "",
        "deep_background": {},
        "hidden_info": [],
        "hidden_info_rules": [],
        "required_inquiries": [],
        "scoring_criteria": {},
        "opening_line": "",
    }

    ctx = PipelineContext(
        record=record,
        case_data=case_data,
        current_user=user,
        db=db,
        app_state=app_state,
        student_input="你好，你哪里不舒服？",
        messages=[],
    )
    # Run up to prompt_builder only (skip LLM call)
    history_pipe, _ = get_pipeline()
    middlewares = [m for m in history_pipe if m.__name__ not in ("_llm_caller",)]
    await run_pipeline(ctx, middlewares)

    assert ctx.should_shortcut is False
    assert ctx.llm_messages is not None
    assert len(ctx.llm_messages) > 0
