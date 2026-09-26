"""管线契约（characterization tests）。

用途：钉住**重构前后必须一致的可观察行为**，不是钉住实现。五阶段显式化
（``runner.STAGES`` 取代枚举 + 链式装配）可以让实现细节变化，但下面这些契约一旦变化
就是行为回归：

1. 阶段执行顺序 == ``runner.STAGES`` 的元组顺序（analysis→…→side_effects）
2. 短路（``ctx.should_shortcut``）：后续阶段不再执行，已产生的 ctx 状态不回滚
3. must-succeed vs best-effort：PERSIST 失败 = 请求错误；SIDE_EFFECTS 失败 = 只记录日志
4. SSE 错误帧形状（``data: `` 前缀 + ``\\n\\n`` 结尾 + 稳定 ``code``）；非流式路径不产出帧
5. ``STATE_*`` 传值契约：前阶段写入、后阶段可读（按对象身份，不经拷贝）

全部用例不依赖数据库、不依赖 LLM 网络调用（DB 以最小替身注入）。
"""

from __future__ import annotations

import json
from types import SimpleNamespace
from typing import Any

import pytest

import modules.training.pipeline.runner as runner_mod
from modules.training.pipeline.context import (
    STATE_ASSEMBLER,
    STATE_DONE_PAYLOAD,
    STATE_EMOTION_CHANGE,
    STATE_EMOTION_DOMINANT,
    STATE_EMOTION_NOTE,
    STATE_FEATURES,
    STATE_SAVED_MESSAGES,
    STATE_TURN,
    PipelineContext,
)
from modules.training.pipeline.runner import STAGES, _error_frame, run_pipeline, stream_pipeline
from modules.training.pipeline.turn import ERROR_PIPELINE, TurnClaim, TurnStatus

#: 声明的阶段名顺序（由 ``runner.STAGES`` 派生）：探测桩据此装配。
_ORDERED_STAGE_NAMES: list[str] = [name for name, _ in STAGES]


# ---------------------------------------------------------------- helpers


def _ctx(*, db: Any = None, app_state: Any = None) -> PipelineContext:
    """最小 ctx：无 DB、无网络（record 只需 id/可读属性）。"""
    record = SimpleNamespace(id=7, case_id=1, runtime_state={}, practice_snapshot={}, workflow_id="history_taking")
    user = SimpleNamespace(id=1)
    return PipelineContext(
        record=record,
        case_data={},
        current_user=user,
        db=object() if db is None else db,
        app_state=object() if app_state is None else app_state,
    )


def _parse_sse(frame: str) -> dict:
    """断言帧是合法 SSE 形状并取出 data 载荷。"""
    assert frame.startswith("data: "), repr(frame)
    assert frame.endswith("\n\n"), repr(frame)
    body = frame.removeprefix("data: ").removesuffix("\n\n")
    assert "\n" not in body, repr(frame)
    return json.loads(body)


def _real_stage(name: str) -> Any:
    """真实（未打桩）阶段入口：阶段名必须在 ``STAGES`` 里恰好出现一次。"""
    return dict(STAGES)[name]


def _only_stage(monkeypatch, name: str) -> Any:
    """把 ``runner.STAGES`` 收窄到只剩该真实阶段（单阶段用例）。"""
    stage = _real_stage(name)
    monkeypatch.setattr(runner_mod, "STAGES", ((name, stage),))
    return stage


class _ProbeStages:
    """探测桩阶段表：入口替身 + 调用记录。"""

    def __init__(self, entries: dict[str, Any]):
        self.entries = entries
        self.order: list[str] = []

    def stages(self) -> tuple[tuple[str, Any], ...]:
        return tuple((name, self.entries[name]) for name in _ORDERED_STAGE_NAMES)


@pytest.fixture
def probe_pipeline(monkeypatch):
    """把五个阶段入口换成探测桩，返回 ``install(hooks)``。

    hooks: ``{阶段名: hook(ctx)}``，hook 内可写 ctx / 短路 / 抛异常。
    桩的语义与真实阶段一致：只做自己那一段（推进由 runner 负责）。
    """

    def install(hooks: dict[str, Any] | None = None) -> _ProbeStages:
        hooks = hooks or {}
        built = _ProbeStages({})
        for name in _ORDERED_STAGE_NAMES:
            hook = hooks.get(name)

            async def probe(ctx, *, _stage=name, _hook=hook):
                built.order.append(_stage)
                if _hook is not None:
                    _hook(ctx)

            built.entries[name] = probe
        monkeypatch.setattr(runner_mod, "STAGES", built.stages())
        return built

    return install


# -------------------------------------------------- 1. 阶段顺序


def test_stage_names_are_declared_in_order():
    """顺序契约只有这一处硬编码：阶段名依次为 analysis/prompt/llm/persist/side_effects。"""
    assert [name for name, _ in STAGES] == ["analysis", "prompt", "llm", "persist", "side_effects"]


@pytest.mark.asyncio
async def test_stages_are_executed_in_declared_order(probe_pipeline):
    """实际执行顺序 == ``runner.STAGES`` 声明的顺序（每阶段恰好执行一次）。"""
    probe = probe_pipeline()

    await run_pipeline(_ctx())
    assert probe.order == _ORDERED_STAGE_NAMES


# -------------------------------------------------- 2. 短路


@pytest.mark.asyncio
async def test_short_circuit_stops_downstream_stages_without_rollback(probe_pipeline):
    """PROMPT 短路 → LLM/PERSIST/SIDE_EFFECTS 不执行；已写入的 ctx 状态保留。"""

    def analysis(ctx):
        ctx.state[STATE_EMOTION_NOTE] = "情绪注记"

    def prompt(ctx):
        ctx.should_shortcut = True

    probe = probe_pipeline({"analysis": analysis, "prompt": prompt})
    ctx = _ctx()
    await run_pipeline(ctx)

    assert probe.order == _ORDERED_STAGE_NAMES[:2]
    # 回滚即"短路前产出消失"；契约要求它们原样留下
    assert ctx.state[STATE_EMOTION_NOTE] == "情绪注记"
    assert ctx.llm_messages is None  # LLM 阶段没跑
    assert ctx.error is None  # 纯短路不构成错误


@pytest.mark.asyncio
async def test_short_circuit_from_llm_stage_skips_persist_and_side_effects(probe_pipeline):
    """LLM 阶段失败（error + code + shortcut）→ PERSIST/SIDE_EFFECTS 均不执行。"""

    def llm(ctx):
        ctx.error = "模型不可用"
        ctx.error_code = "chat.llm_unavailable"
        ctx.should_shortcut = True

    probe = probe_pipeline({"llm": llm})
    ctx = _ctx()
    await run_pipeline(ctx)

    assert probe.order == _ORDERED_STAGE_NAMES[:3]
    assert ctx.error_code == "chat.llm_unavailable"  # 稳定错误码不被覆盖


# -------------------------------------- 3a. PERSIST must-succeed


@pytest.mark.asyncio
async def test_persist_stage_failure_ends_request_in_error_path(probe_pipeline):
    """PERSIST 抛异常 → 请求以错误结束（不静默吞），且后续阶段不再执行。"""

    def persist(_ctx_):
        raise RuntimeError("persist exploded")

    probe = probe_pipeline({"persist": persist})
    ctx = _ctx()
    await run_pipeline(ctx)  # 异常不逃出 run_pipeline（否则本调用即报错）

    assert probe.order == _ORDERED_STAGE_NAMES[:4]
    assert ctx.error == "persist exploded"
    assert ctx.error_code == ERROR_PIPELINE


class _FakeDB:
    """最小 DB 替身：flush 前 N 次抛错，其余只分配自增 id / 记录 commit。"""

    def __init__(self, *, fail_flushes: int = 0):
        self.fail_flushes = fail_flushes
        self.added: list[Any] = []
        self.committed = 0
        self._next_id = 100
        self._rows: dict[Any, Any] = {}

    def add(self, obj):
        self.added.append(obj)

    def flush(self):
        if self.fail_flushes > 0:
            self.fail_flushes -= 1
            raise RuntimeError("db down")
        for obj in self.added:
            if getattr(obj, "id", None) is None:
                self._next_id += 1
                obj.id = self._next_id

    def get(self, model, pk):
        return self._rows.setdefault((model, pk), SimpleNamespace(result={}))

    def commit(self):
        self.committed += 1

    def rollback(self):
        pass

    def refresh(self, obj):
        pass


def _pending_claim(record_id: int = 7) -> TurnClaim:
    return TurnClaim(
        turn_id=11,
        record_id=record_id,
        request_id="t-1",
        status=str(TurnStatus.PENDING),
        student_message_id=5,
    )


@pytest.mark.asyncio
async def test_real_persist_stage_does_not_swallow_db_failure(monkeypatch):
    """真实 persister：DB 失败必须变成请求错误 + 回合兜底收尾（绝不静默成功/留在 pending）。"""
    _only_stage(monkeypatch, "persist")

    db = _FakeDB(fail_flushes=1)  # 第一次 flush = 事务 B 失败；兜底收尾那次可用
    ctx = _ctx(db=db)
    claim = _pending_claim(ctx.record.id)
    ctx.state[STATE_TURN] = claim
    ctx.llm_reply = "患者回复"

    await run_pipeline(ctx)

    assert ctx.error == "db down"
    assert ctx.error_code == ERROR_PIPELINE
    assert claim.status == str(TurnStatus.FAILED)  # 兜底收尾：不静默留在 pending


@pytest.mark.asyncio
async def test_real_persist_stage_marks_turn_completed_and_saves_messages(monkeypatch):
    """真实 persister 成功路径：回合完成 + 患者消息进入 STATE_SAVED_MESSAGES。"""
    _only_stage(monkeypatch, "persist")

    db = _FakeDB()
    ctx = _ctx(db=db)
    claim = _pending_claim(ctx.record.id)
    ctx.state[STATE_TURN] = claim
    ctx.llm_reply = "患者回复"

    await run_pipeline(ctx)

    assert ctx.error is None
    assert claim.status == str(TurnStatus.COMPLETED)
    saved = ctx.state[STATE_SAVED_MESSAGES]
    assert [(m.role, m.content) for m in saved] == [("patient", "患者回复")]
    assert db.committed >= 1


# -------------------------------------- 3b. SIDE_EFFECTS best-effort


class _RaisingQueryDB:
    """任何查询都失败的 DB 替身（模拟侧效果期间的 DB 故障）。"""

    def query(self, *args, **kwargs):
        raise RuntimeError("db down")


@pytest.mark.asyncio
async def test_real_side_effects_failure_is_best_effort(caplog, monkeypatch):
    """真实 side_effects：内部失败被吞成日志 —— 请求不入错误路径，前序产出照常下发。"""
    _only_stage(monkeypatch, "side_effects")

    ctx = _ctx(db=_RaisingQueryDB(), app_state=SimpleNamespace(initiative_cache=object()))
    ctx.llm_reply = "回复"
    ctx.state[STATE_FEATURES] = {"emotion": True, "patient_initiative": True}
    ctx.state[STATE_EMOTION_CHANGE] = {"trust": 0.6, "anxiety": 0.4, "irritation": 0.2, "cooperation": 0.8}
    ctx.state[STATE_EMOTION_DOMINANT] = "合作"

    frames = [frame async for frame in stream_pipeline(ctx)]
    payloads = [_parse_sse(frame) for frame in frames]

    assert ctx.error is None
    assert ctx.error_code is None
    # 证据：确实在阶段内部抛了异常并被吞成日志（否则本用例是空转）
    assert any("Initiative state emission failed" in record.message for record in caplog.records)
    # 失败发生在 initiative 分支：之前产出的 emotion_change 不受影响（无回滚）
    assert any("emotion_change" in payload for payload in payloads)
    assert payloads[-1]["done"] is True
    assert not any("error" in payload for payload in payloads)


# -------------------------------------------------- 4. SSE 错误帧


def test_error_frame_is_valid_sse_with_stable_code():
    """错误帧形状：``data: {...}\\n\\n``，携带 error 文案与稳定 code。"""
    ctx = _ctx()
    ctx.error = "模型调用失败"
    ctx.error_code = "chat.llm_unavailable"

    assert _parse_sse(_error_frame(ctx)) == {"error": "模型调用失败", "code": "chat.llm_unavailable"}


def test_error_frame_defaults_without_code():
    """无 error / 无 code 时的兜底形状（不含 code 键）。"""
    assert _parse_sse(_error_frame(_ctx())) == {"error": "生成失败"}


def test_error_frame_truncates_long_message():
    """错误文案截断到 200 字符（客户端帧大小有界）。"""
    ctx = _ctx()
    ctx.error = "长" * 500
    assert len(_parse_sse(_error_frame(ctx))["error"]) == 200


@pytest.mark.asyncio
async def test_stream_pipeline_emits_error_frame_with_code_on_stage_failure(probe_pipeline):
    """流式路径：阶段异常 → 仅错误帧（合法 SSE、带 ERROR_PIPELINE），无 done 帧。"""

    def llm(_ctx_):
        raise RuntimeError("llm exploded")

    probe = probe_pipeline({"llm": llm})
    frames = [frame async for frame in stream_pipeline(_ctx())]

    assert probe.order == _ORDERED_STAGE_NAMES[:3]
    assert len(frames) == 1
    payload = _parse_sse(frames[0])
    assert payload == {"error": "llm exploded", "code": ERROR_PIPELINE}


@pytest.mark.asyncio
async def test_stream_pipeline_short_circuit_without_error_yields_done_frame(probe_pipeline):
    """短路 ≠ 错误：纯短路（无 error）以 done 帧收尾，不产错误帧。"""

    def prompt(ctx):
        ctx.should_shortcut = True

    probe = probe_pipeline({"prompt": prompt})
    ctx = _ctx()
    ctx.state[STATE_DONE_PAYLOAD] = {"corrections_used": 0}

    frames = [frame async for frame in stream_pipeline(ctx)]
    payloads = [_parse_sse(frame) for frame in frames]

    assert probe.order == _ORDERED_STAGE_NAMES[:2]
    assert payloads[-1] == {"done": True, "id": None, "corrections_used": 0}
    assert not any("error" in payload for payload in payloads)


@pytest.mark.asyncio
async def test_non_stream_error_path_produces_no_sse_frame(probe_pipeline, monkeypatch):
    """非流式路径不产出任何 SSE 帧：错误只经 ctx.error/error_code 暴露给调用方。"""
    frame_calls: list[str] = []
    monkeypatch.setattr(runner_mod, "_error_frame", lambda ctx: frame_calls.append("called") or "data: {}\n\n")

    def llm(_ctx_):
        raise RuntimeError("llm exploded")

    probe_pipeline({"llm": llm})
    ctx = _ctx()
    result = await run_pipeline(ctx)

    assert result is None
    assert frame_calls == []
    assert ctx.error == "llm exploded"
    assert ctx.error_code == ERROR_PIPELINE


# -------------------------------------------------- 5. ctx 传值契约


@pytest.mark.asyncio
async def test_state_keys_written_by_earlier_stage_are_readable_downstream(probe_pipeline):
    """真实 STATE_* 键的前写后读：对象身份不变（同一次调用的 ctx.state 透传）。"""
    note = object()
    assembler = object()
    saved: list[object] = [object()]
    seen: dict[str, Any] = {}

    def analysis(ctx):
        ctx.state[STATE_EMOTION_NOTE] = note
        ctx.state[STATE_EMOTION_DOMINANT] = "焦虑"

    def prompt(ctx):
        seen["prompt_note"] = ctx.state.get(STATE_EMOTION_NOTE)  # 跨阶段读 ANALYSIS 的产物
        ctx.state[STATE_ASSEMBLER] = assembler

    def llm(ctx):
        seen["llm_assembler"] = ctx.state.get(STATE_ASSEMBLER)  # llm_caller 复用装配器
        seen["llm_dominant"] = ctx.state.get(STATE_EMOTION_DOMINANT)

    def persist(ctx):
        seen["persist_note"] = ctx.state.get(STATE_EMOTION_NOTE)
        ctx.state[STATE_SAVED_MESSAGES] = saved

    def side_effects(ctx):
        seen["side_saved"] = ctx.state.get(STATE_SAVED_MESSAGES)  # runner 快照 done id 用同一键
        seen["side_assembler"] = ctx.state.get(STATE_ASSEMBLER)

    probe_pipeline(
        {
            "analysis": analysis,
            "prompt": prompt,
            "llm": llm,
            "persist": persist,
            "side_effects": side_effects,
        }
    )
    await run_pipeline(_ctx())

    assert seen == {
        "prompt_note": note,
        "llm_assembler": assembler,
        "llm_dominant": "焦虑",
        "persist_note": note,
        "side_saved": saved,
        "side_assembler": assembler,
    }
    assert seen["prompt_note"] is note  # 不拷贝、不被回滚
    assert seen["persist_note"] is note
    assert seen["llm_assembler"] is assembler
    assert seen["side_saved"] is saved


@pytest.mark.asyncio
async def test_saved_messages_reach_done_frame_id(monkeypatch):
    """真实链路：persister 写 STATE_SAVED_MESSAGES → runner 快照 → done 帧带患者消息 id。"""
    _only_stage(monkeypatch, "persist")

    ctx = _ctx(db=_FakeDB())
    ctx.state[STATE_TURN] = _pending_claim(ctx.record.id)
    ctx.llm_reply = "患者回复"

    frames = [frame async for frame in stream_pipeline(ctx)]
    saved = ctx.state[STATE_SAVED_MESSAGES]

    assert [(m.role, m.content) for m in saved] == [("patient", "患者回复")]
    assert _parse_sse(frames[-1]) == {"done": True, "id": saved[0].id}
