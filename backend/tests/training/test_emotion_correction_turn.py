"""修正轮必须重算情绪：turn_id 不能与被修正的那一轮撞车（评审 #6）。

修正路径构造的 ctx.messages 是"被修正那轮之前"的历史，与被修正轮完全一致 →
只按 max(msg.id) 生成的 turn_id 会命中 last_turn_id 去重而整轮跳过，情绪便停留在
已被删除的那句话上，与 DB/评分（都是新文本）分叉。
"""

from importlib import import_module
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

# 包 __init__ 把同名函数导出，遮蔽了子模块属性 → 只能按模块路径取
emotion_middleware = import_module("modules.training.pipeline.middleware.emotion_analysis")
from modules.training.patient_ai.emotion import EmotionState, EmotionVector
from modules.training.patient_ai.emotion.events import (
    DetectedEmotionEvent,
    EmotionAnalysisResult,
    EmotionEventType,
)
from modules.training.pipeline import PipelineContext
from modules.training.pipeline.context import (
    STATE_CORRECTION_TURN,
    STATE_EMOTION_CHANGE,
    STATE_FEATURES,
)

EXISTING_TURN_ID = "5-11"  # 被修正的那一轮已经占用


class _FakeRepo:
    def __init__(self, state: EmotionState) -> None:
        self.state = state
        self.appended: list[tuple[str, list]] = []

    def get_or_create(self, record_id: int, db):
        return self.state

    def save(self, record_id: int, state: EmotionState, db):
        self.state = state
        return state

    def append_events(self, record_id: int, turn_id: str, events: list, db) -> None:
        self.appended.append((turn_id, events))


class _FakeAnalyzer:
    def __init__(self, *args, **kwargs) -> None:
        pass

    async def analyze(self, **kwargs) -> EmotionAnalysisResult:
        return EmotionAnalysisResult(
            events=[DetectedEmotionEvent(type=EmotionEventType.EMPATHY, confidence=1.0, evidence="我理解")]
        )


def _ctx(*, correction_turn: int | None = None):
    ctx = PipelineContext(
        record=SimpleNamespace(id=5, case_id=1),
        case_data={"personality": {}},
        current_user=SimpleNamespace(id=1),
        db=MagicMock(),
        app_state=MagicMock(),
        student_input="我理解您很担心",
        student_display="我理解您很担心",
        messages=[
            SimpleNamespace(id=10, role="student", content="上一句学生发言"),
            SimpleNamespace(id=11, role="patient", content="上一句患者回复"),
        ],
    )
    ctx.state[STATE_FEATURES] = {"emotion": True}
    if correction_turn is not None:
        ctx.state[STATE_CORRECTION_TURN] = correction_turn
    return ctx


async def _run(monkeypatch, ctx) -> _FakeRepo:
    repo = _FakeRepo(EmotionState(vector=EmotionVector.neutral(), version=3, last_turn_id=EXISTING_TURN_ID))
    monkeypatch.setattr(emotion_middleware, "EmotionRepository", lambda: repo)
    monkeypatch.setattr(emotion_middleware, "EmotionAnalyzer", _FakeAnalyzer)

    async def _next() -> None:
        return None

    await emotion_middleware.emotion_analysis(ctx, _next)
    # 中间件吞掉异常（降级路径）：用它是否产出行为策略判断本轮确实算过
    assert STATE_EMOTION_CHANGE in ctx.state
    return repo


@pytest.mark.asyncio
async def test_correction_turn_is_recomputed(monkeypatch):
    ctx = _ctx(correction_turn=1)
    repo = await _run(monkeypatch, ctx)

    assert repo.appended, "修正轮必须重新写入情绪事件（否则情绪停留在被删掉的那句话上）"
    assert repo.appended[0][0] == f"{EXISTING_TURN_ID}-c1"


@pytest.mark.asyncio
async def test_normal_turn_on_same_message_is_still_deduplicated(monkeypatch):
    """普通路径语义不变：同一轮重复执行仍按 turn_id 跳过（幂等保护）。"""
    repo = await _run(monkeypatch, _ctx())

    assert repo.appended == []
