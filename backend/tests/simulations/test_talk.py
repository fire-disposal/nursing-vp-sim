"""TALK command group — LLM-simulated patient/family conversation.

The engine records the player's line and consumes time; the persona reply is
produced at the service boundary from KNOWN observations only (never the
hidden course), mirroring the consult pattern.
"""

from typing import TYPE_CHECKING, cast

from modules.simulations import engine as e
from modules.simulations.engine import new_session
from modules.simulations.service import SimulationService
from modules.simulations.state import state_from_dict, state_to_dict
from tests.simulations.test_api_flow import _FakeSession  # reuse the fake-DB harness

if TYPE_CHECKING:
    from sqlalchemy.orm import Session


def _service() -> SimulationService:
    # The fake mimics the small Session surface SimulationService uses;
    # cast keeps the test type-clean (ty flags raw fakes).
    return SimulationService(cast("Session", _FakeSession()))


class _FakeTalk:
    def __init__(self, reply="嗯…就是伤口有点疼，别的也说不上来。"):
        self.reply = reply
        self.calls = []

    async def call(self, messages, **kwargs):
        self.calls.append(messages)
        return self.reply


def test_talk_patient_consumes_time_and_records_line():
    s = new_session()
    ok, msgs = e.apply_action(s, "TALK", "patient", "你现在感觉怎么样？")
    assert ok
    assert s.current_time == 2  # TALK duration 2min
    assert any(m.kind == "TALK" and "你（对患者说）" in m.text for m in msgs)


def test_talk_family_uses_family_target():
    s = new_session()
    ok, msgs = e.apply_action(s, "TALK", "family", "他夜里睡得怎么样？")
    assert ok
    assert any(m.kind == "TALK" and "对家属说" in m.text for m in msgs)


def test_talk_rejects_invalid_target_and_empty_line():
    s = new_session()
    ok, msgs = e.apply_action(s, "TALK", "doctor", "你好")
    assert not ok
    assert any("对话对象无效" in m.text for m in msgs)
    ok2, msgs2 = e.apply_action(s, "TALK", "patient", "")
    assert not ok2
    assert any("请说出" in m.text for m in msgs2)


def test_talk_blocked_after_case_end():
    s = new_session()
    e.apply_action(s, "WAIT", None)
    e.apply_action(s, "WAIT", None)  # failure at 90
    ok, msgs = e.apply_action(s, "TALK", "patient", "你好")
    assert not ok
    assert any("已结束" in m.text for m in msgs)


def test_service_talk_calls_persona_with_known_info_only():
    fake = _FakeTalk()
    service = _service()
    session = service.create(1)

    def provider(role, summary, line):
        fake.calls.append((role, summary, line))
        return fake.reply

    messages, accepted = service.act(
        session,
        "TALK",
        "patient",
        text="您现在感觉怎么样？",
        talk_provider=provider,
    )
    assert accepted
    assert any("嗯…就是伤口有点疼" in m.text for m in messages)
    # Provider was invoked with the player's line; the persona never receives
    # the hidden state (build_consult_summary is the only context).
    assert fake.calls
    system, summary, line = fake.calls[0]
    assert "王秀兰" in system  # 患者背景来自病例，而非硬编码
    assert "信任护士" in system  # 患者角色前缀
    assert line == "您现在感觉怎么样？"
    assert "严重度" not in summary
    assert "0.12" not in summary
    # Persisted: reload and the reply is in the public log.
    restored = state_from_dict(session.state)
    assert any(m.kind == "TALK" and "伤口有点疼" in m.text for m in restored.public_log)


def test_service_talk_falls_back_when_llm_down():
    service = _service()
    session = service.create(1)
    messages, accepted = service.act(
        session,
        "TALK",
        "patient",
        text="您好？",
        talk_provider=lambda role, summary, line: (_ for _ in ()).throw(RuntimeError("llm down")),
    )
    assert accepted
    assert any("患者虚弱" in m.text for m in messages)


def test_service_talk_falls_back_when_provider_missing():
    service = _service()
    session = service.create(1)
    messages, accepted = service.act(session, "TALK", "family", text="他怎么样？")
    assert accepted
    assert any("家属" in m.text and "不清楚" in m.text for m in messages) or any(
        "家属" in m.text and "不太清楚" in m.text for m in messages
    )


def test_talk_does_not_leak_hidden_course_to_summary():
    from modules.simulations.engine import build_consult_summary

    s = new_session()
    e.apply_action(s, "ASSESS", "vitals")
    summary = build_consult_summary(s)
    assert "严重度" not in summary
    assert "bleeding" not in summary
    assert "0.12" not in summary


def test_talk_roundtrip_persists_session():
    service = _service()
    session = service.create(1)
    service.act(
        session,
        "TALK",
        "patient",
        text="你现在感觉怎么样？",
        talk_provider=lambda role, summary, line: "有点头晕。",
    )
    raw = state_to_dict(state_from_dict(session.state))
    assert any(m["kind"] == "TALK" and "头晕" in m["text"] for m in raw["public_log"])


class _FakeDiagnose:
    def __init__(self, verdict="命中：完全命中，诊断正确。"):
        self.verdict = verdict
        self.calls: list[str] = []

    def __call__(self, prompt: str) -> str:
        self.calls.append(prompt)
        return self.verdict


def test_service_diagnosis_review_runs_once_on_case_end():
    fake = _FakeDiagnose()
    service = _service()
    session = service.create(1)

    # 记录诊断（不终结病例）
    messages, accepted = service.act(session, "DIAG", "疑诊隐匿性出血")
    assert accepted
    assert any("已记录你的诊断" in m.text for m in messages)

    # 推进到病例终结（出血病例多次 WAIT 至 failure）
    for _ in range(12):
        if session.status != "ACTIVE":
            break
        service.act(session, "WAIT", None, diagnose_provider=fake)

    assert session.status != "ACTIVE"
    # 诊断评分只在终结时触发一次，且 prompt 同时含护士诊断与真实病情
    assert len(fake.calls) == 1
    assert "疑诊隐匿性出血" in fake.calls[0]
    assert "隐匿性出血" in fake.calls[0]  # 真实病情（diag_hint）

    restored = state_from_dict(session.state)
    assert any(m.kind == "AUDIT" and "诊断复盘" in m.text for m in restored.public_log)


def test_service_diagnosis_review_skipped_without_diagnosis():
    fake = _FakeDiagnose()
    service = _service()
    session = service.create(1)

    # 未记录诊断直接终结：不应触发评分
    for _ in range(12):
        if session.status != "ACTIVE":
            break
        service.act(session, "WAIT", None, diagnose_provider=fake)

    assert session.status != "ACTIVE"
    assert fake.calls == []
