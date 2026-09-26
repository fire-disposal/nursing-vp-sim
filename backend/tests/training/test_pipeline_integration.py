"""Integration test: pipeline produces same result as existing flow."""

from unittest.mock import AsyncMock, MagicMock

import pytest

from modules.training.pipeline.builder import build_note_collector
from modules.training.pipeline.context import STATE_TURN, PipelineContext
from modules.training.pipeline.runner import run_pipeline
from modules.training.pipeline.turn import TurnClaim, TurnStatus


@pytest.mark.asyncio
async def test_pipeline_without_operation_passes_to_llm_caller():
    """Normal chat message flows through to LLM without short-circuit."""
    record = MagicMock()
    record.id = 1
    record.user_id = 1
    record.case_id = 1
    record.practice_snapshot = {"features": {}}
    # 记录冻结的 workflow（判别列，docs/15 §二）：测试替身也必须满足该契约
    record.workflow_id = "history_taking"

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
    # 回合句柄由 router 的事务 A 建立（见 pipeline/turn.py）：persister 只做事务 B
    ctx.state[STATE_TURN] = TurnClaim(
        turn_id=7,
        record_id=record.id,
        request_id="t-1",
        status=str(TurnStatus.PENDING),
        student_message_id=1,
    )
    # 上下文来源的装配与阶段排序解耦：router 侧装配好 collector 后挂到 ctx
    ctx.note_collector = build_note_collector()
    await run_pipeline(ctx)

    assert ctx.should_shortcut is False
    assert ctx.llm_messages is not None
    assert len(ctx.llm_messages) > 0
    # 事务 B：患者消息落库 + 回合 completed；学生消息不在这里插（事务 A 已写）
    roles = [getattr(call.args[0], "role", None) for call in db.add.call_args_list]
    assert "patient" in roles
    assert "student" not in roles
    assert ctx.state[STATE_TURN].status == TurnStatus.COMPLETED
