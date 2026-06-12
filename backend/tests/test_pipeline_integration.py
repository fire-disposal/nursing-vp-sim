"""Integration test: pipeline produces same result as existing flow."""

from unittest.mock import AsyncMock, MagicMock

import pytest

from contexts.training.pipeline import PipelineContext, get_pipeline, run_pipeline
from contexts.training.pipeline.phase import Phase


@pytest.mark.asyncio
async def test_pipeline_shortcuts_on_operation():
    """When an operation is detected, pipeline short-circuits — no LLM call."""
    record = MagicMock()
    record.id = 1
    record.user_id = 1
    record.case_id = 1
    record.current_phase = None
    record.practice_snapshot = {"features": {"physical_exam": True}}

    user = MagicMock()
    user.id = 1

    db = MagicMock()

    mock_pm = MagicMock()
    mock_pm.get = AsyncMock()
    mock_pm.get.return_value = MagicMock()
    mock_pm.get.return_value.render = MagicMock(return_value="sys prompt")

    app_state = MagicMock()
    app_state.prompt_manager = mock_pm
    app_state.httpx_client = MagicMock()
    app_state.llm_router = MagicMock()
    app_state.log_worker = MagicMock()
    mock_llm_client = MagicMock()
    mock_llm_client.call = AsyncMock(return_value="mock reply")
    mock_llm_client.call_json = AsyncMock(return_value={})
    mock_llm_client.stream = AsyncMock()
    app_state.llm_client = mock_llm_client

    case_data = {
        "exam_anchors": {
            "vital_signs": {
                "temperature": "36.5",
                "blood_pressure": "120/80",
                "heart_rate": "72",
                "respiratory_rate": "16",
                "spo2": "98",
            }
        }
    }

    ctx = PipelineContext(
        record=record,
        case_data=case_data,
        current_user=user,
        db=db,
        app_state=app_state,
        student_input="/vitals",
        messages=[],
    )
    ctx.setup_phases()
    ctx.current_phase = Phase(id="history_taking", operations=["chat", "vitals", "bp", "temp", "spo2", "hr", "rr"])

    pipe = get_pipeline({"physical_exam": True})
    await run_pipeline(ctx, pipe)

    assert ctx.should_shortcut is True
    assert ctx.operation is not None
    assert ctx.operation.get("type") == "vitals"
    assert "生命体征" in ctx.operation.get("label", "")


@pytest.mark.asyncio
async def test_pipeline_without_operation_passes_to_llm_caller():
    """Normal chat message flows through to LLM without short-circuit."""
    record = MagicMock()
    record.id = 1
    record.user_id = 1
    record.case_id = 1
    record.current_phase = None
    record.practice_snapshot = {"features": {}}

    user = MagicMock()
    user.id = 1

    db = MagicMock()

    mock_pm = MagicMock()
    mock_pm.get = AsyncMock()
    mock_pm.get.return_value = MagicMock()
    mock_pm.get.return_value.render = MagicMock(return_value="sys prompt")

    app_state = MagicMock()
    app_state.prompt_manager = mock_pm
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
    ctx.setup_phases()
    ctx.current_phase = Phase(id="history_taking")

    # Run up to prompt_builder only (skip LLM call)
    history_pipe = get_pipeline()
    middlewares = [m for m in history_pipe if m.__name__ not in ("_llm_caller",)]
    await run_pipeline(ctx, middlewares)

    assert ctx.should_shortcut is False
    assert ctx.llm_messages is not None
    assert len(ctx.llm_messages) > 0
