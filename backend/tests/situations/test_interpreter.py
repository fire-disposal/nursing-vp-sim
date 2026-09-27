"""情境解释器：往返无损 + 时间轴协议 + affordance 登记（纯逻辑，不碰数据库）。

往返证明的口径：
1. ``case1`` + 4 个蓝图病例（V2）**逐字段**往返相等（raw dict 相等）；
2. 目录里全部 14 个真实病例的**消费端视图**往返相等（患者提示词变量 / scene 块 / activity 集合 /
   问题清单 / 示例对话 / 开场白）；
3. 真实病例里没被两个函数"照顾"到的字段（``difficulty`` / ``time_limit`` / ``blueprint`` /
   未来的新字段）必须原样待在 ``case_fields`` 里 —— 不许静默丢弃。
"""

from __future__ import annotations

import json
from copy import deepcopy
from pathlib import Path
from typing import Any

import pytest

from modules.situations.interpreter import (
    AFFORDANCE_BY_ACTIVITY,
    AFFORDANCE_VOCABULARY,
    CASE_FIELDS_KEY,
    DEFAULT_WORKFLOW_ID,
    FACT_FIELDS,
    PATIENT_ACTOR_ID,
    affordance_report,
    apply_timeline,
    case_consumed_view,
    case_from_situation,
    situation_consumed_view,
    situation_from_case,
)
from modules.situations.schema import Actor, Affordance, Situation, TimelineStep
from modules.training.activities import ACTIVITY_IDS

CASES_DIR = Path(__file__).resolve().parents[2] / "data" / "cases"

#: 验收点名的集合：case1 + 4 个「蓝图病例」（V2 = 带 ``blueprint`` 的那一族）
NAMED_CASES = (
    "case1.json",
    "asthma_exacerbation.json",
    "pediatric_fever_dehydration.json",
    "postop_complication_communication.json",
    "t2dm_adherence.json",
)


def _load(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


ALL_CASES = sorted(CASES_DIR.glob("*.json"))
BLUEPRINT_CASES = [path for path in ALL_CASES if _load(path).get("blueprint")]
ROUNDTRIP_CASES = [CASES_DIR / name for name in NAMED_CASES]


def _diff_message(original: dict[str, Any], decoded: dict[str, Any]) -> str:
    """逐字段差异说明（不等就说清是哪个字段、原值是什么、解码成了什么）。"""
    lines: list[str] = []
    for key in sorted(set(original) | set(decoded)):
        before, after = original.get(key, "<缺失>"), decoded.get(key, "<缺失>")
        if before != after:
            lines.append(f"  {key}: {before!r} -> {after!r}")
    return "\n".join(lines)


def _patient_prompt_situation() -> Situation:
    """一个最小但完整的手写情境（时间轴 / affordance 协议用）。"""
    return Situation(
        title="测试情境",
        actors=[Actor(id=PATIENT_ACTOR_ID, name="测试患者", medium="in_person", knows=["chief_complaint"])],
        state={"facts": {"chief_complaint": "胸痛2小时"}, "hidden": {"咯血": "没说"}},
        timeline=[
            TimelineStep(
                id="deteriorate",
                when={"turns_gte": 5},
                patch={"spo2": 88},
                speaker=PATIENT_ACTOR_ID,
                say="我……有点喘不上气了……",
                event={"kind": "vitals_alarm", "severity": "high"},
            ),
            TimelineStep(id="recurring", when={"elapsed_gte": 60}, patch={"fatigue": True}, once=False),
            TimelineStep(
                id="on_disclosure",
                when={"state_eq": {"disclosed": True}},
                patch={"trust": 1},
                speaker=PATIENT_ACTOR_ID,
                say="其实还有件事我一直没说……",
            ),
        ],
        affordances=[
            Affordance(
                key="record",
                label="护理记录",
                config={"case_activity_id": "nursing_record", "case_declaration": {"config": True}},
            ),
            Affordance(key="quiz"),
            Affordance(key="hypnosis", label="未注册的能力"),
        ],
    )


# ── a) 往返无损 ───────────────────────────────────────────────────────────


def test_v2_case_family_is_the_five_named_cases() -> None:
    """验收点名的 5 个病例都在仓库里，且「V2 = blueprint 病例」今天正好是这 4 个。"""
    present = {path.name for path in ALL_CASES}
    assert set(NAMED_CASES) <= present, sorted(set(NAMED_CASES) - present)
    assert {path.name for path in BLUEPRINT_CASES} == set(NAMED_CASES) - {"case1.json"}
    assert len(ALL_CASES) >= len(NAMED_CASES)  # 全部真实病例都参与消费端视图往返


@pytest.mark.parametrize("path", ROUNDTRIP_CASES, ids=lambda p: p.stem)
def test_case_roundtrip_is_lossless_field_by_field(path: Path) -> None:
    """真实病例逐字段往返相等（raw dict）：一个字段都不许掉，一个字段都不许变。"""
    case = _load(path)
    situation = situation_from_case(case)
    decoded = case_from_situation(situation)

    assert set(case) - set(decoded) == set(), f"{path.name} 往返后丢字段：{sorted(set(case) - set(decoded))}"
    assert decoded == case, f"{path.name} 往返不等：\n{_diff_message(case, decoded)}"
    assert case_consumed_view(case) == situation_consumed_view(situation)

    # 情境这一层必须真的承载了内容，而不是靠"原样塞回 case_fields"蒙混过关
    assert situation.title == case["name"]
    assert situation.actors[0].knows == [field for field in FACT_FIELDS if field in case]
    assert situation.environment == case.get("scene")
    assert [affordance.key for affordance in situation.affordances] == [
        AFFORDANCE_BY_ACTIVITY[activity_id] for activity_id in case["activities"]
    ]


@pytest.mark.parametrize("path", ALL_CASES, ids=lambda p: p.stem)
def test_every_case_keeps_its_consumed_view(path: Path) -> None:
    """目录里全部真实病例（含无 scene / 无 blueprint 的老病例）的消费端视图往返相等。"""
    case = _load(path)
    situation = situation_from_case(case)

    assert set(case) - set(case_from_situation(situation)) == set(), f"{path.name} 有字段没被承载"
    assert case_consumed_view(case) == situation_consumed_view(situation), f"{path.name} 的消费端视图往返不等"

    # 病例声明的事实必须逐条进入 state（值一个 owner），键名进 actor.knows
    for field in (name for name in FACT_FIELDS if name in case):
        assert situation.state["facts"][field] == case[field]
        assert field in situation.actors[0].knows
    assert situation.actors[0].unaware == list(case.get("deep_background") or {})
    assert situation.state["hidden"] == (case.get("deep_background") or {})


def test_conversion_pins_the_field_home_table() -> None:
    """case1 的情境布局就是归属表本身（改表必改这里）。"""
    case = _load(CASES_DIR / "case1.json")
    situation = situation_from_case(case)
    patient = situation.actors[0]

    assert situation.schema_version == 1
    assert situation.brief == case["description"]
    assert situation.learner["role"] == "nursing_student"
    assert situation.learner["workflow"] == DEFAULT_WORKFLOW_ID
    assert situation.learner["required_inquiries"] == case["required_inquiries"]

    assert len(situation.actors) == 1
    assert (patient.id, patient.name, patient.medium) == (PATIENT_ACTOR_ID, case["patient_info"]["name"], "in_person")
    assert patient.visible == {"age": case["patient_info"]["age"], "gender": case["patient_info"]["gender"]}
    assert patient.behavior == case["personality"]
    assert patient.opening == case["opening_line"]
    assert patient.communication_style == case["communication_style"]
    assert patient.example_dialogues == case["example_dialogues"]

    assert patient.unaware == ["咯血", "停药", "家属担忧"]
    assert set(patient.unaware) == set(situation.state["hidden"])

    # 契约 §3/§5：没有声明就不推进、不判读
    assert situation.timeline == []
    assert situation.judgment == []

    # affordance 由 activities 派生；原始声明体原样留在 config（反译不需要猜）
    assert [affordance.key for affordance in situation.affordances] == ["measure", "record"]
    assert situation.affordances[0].label == "床旁检查"
    assert situation.affordances[0].config["case_activity_id"] == "physical_exam"
    assert situation.affordances[0].config["case_declaration"] == case["activities"]["physical_exam"]

    # 情境今天没有位置的字段原样待在 case_fields（不丢、不改）
    assert situation.model_extra[CASE_FIELDS_KEY] == {
        "difficulty": case["difficulty"],
        "time_limit": case["time_limit"],
    }
    assert set(situation.model_extra[CASE_FIELDS_KEY]) == set(case) - {
        "name",
        "description",
        "patient_info",
        "personality",
        "opening_line",
        "deep_background",
        "required_inquiries",
        "activities",
        "scene",
        *FACT_FIELDS,
        "communication_style",
        "example_dialogues",
    }


def test_conversion_and_decode_do_not_alias_the_input() -> None:
    """转换与反译都是**值**语义：改一边不会牵动另一边。"""
    case = _load(CASES_DIR / "case1.json")
    situation = situation_from_case(case)
    snapshot = situation.model_dump()

    case["scene"]["vitals"]["hr"] = 1
    case["deep_background"]["咯血"] = "改了"
    case["activities"]["physical_exam"]["config"]["skin"]["全身"] = "改了"
    case["chief_complaint"] = "改了"
    assert situation.model_dump() == snapshot

    decoded = case_from_situation(situation)
    decoded["chief_complaint"] = "改回来"
    decoded["scene"]["vitals"]["hr"] = 99
    decoded["activities"]["nursing_record"]["config"] = "改了"
    assert situation.model_dump() == snapshot


def test_unknown_and_ill_shaped_fields_are_preserved_not_dropped() -> None:
    """未来的新字段、形状与情境位置不符的声明：原样退回 case_fields，往返仍相等。"""
    case: dict[str, Any] = {
        "name": "合成病例",
        "description": "只为验证兜底桶",
        "patient_info": {"name": "张三", "age": 40, "gender": "男", "occupation": "厨师"},
        "chief_complaint": "发热",
        "present_illness": "3天",
        "scene": {"environment": {"type": "ward", "hidden_note": "未来才解释的场景键"}},
        "activities": {"quiz": {"config": {"questions": []}, "label": "小测", "unknown_key": 1}},
        "required_inquiries": ["体温"],
        "deep_background": {"隐瞒": "停药"},
        "opening_line": "护士，我烧了三天了。",
        "difficulty": 3,
        "future_field": {"nested": [1, 2, {"deep": True}]},  # 情境今天没有的字段
        "personality": "不是映射",  # 形状与 actors[].behavior 不符
        "opening_style": None,
    }
    situation = situation_from_case(case)

    assert situation.model_extra[CASE_FIELDS_KEY] == {
        "difficulty": 3,
        "future_field": {"nested": [1, 2, {"deep": True}]},
        "personality": "不是映射",
        "opening_style": None,
    }
    assert situation.actors[0].behavior == {}  # 形状不符 → 按未声明，不猜、不转
    assert case_from_situation(situation) == case


def test_activity_declarations_that_cannot_be_expressed_are_rejected_loudly() -> None:
    """已登记但还没有 affordance 映射的 activity、未登记的 activity：报错，不猜。"""
    base = _load(CASES_DIR / "case1.json")

    unmapped = deepcopy(base)
    unmapped["activities"] = {"nursing_diagnosis": {"config": True}}
    with pytest.raises(ValueError, match="affordance"):
        situation_from_case(unmapped)

    unknown = deepcopy(base)
    unknown["activities"] = {"teleportation": {"config": True}}
    with pytest.raises(ValueError, match="未在 ACTIVITY_BINDINGS 登记"):
        situation_from_case(unknown)


def test_affordance_mapping_only_emits_registered_keys() -> None:
    """映射表的落点必须是已登记词表（否则解释器自己就产出"未注册的 key"）。"""
    assert set(AFFORDANCE_BY_ACTIVITY) <= set(ACTIVITY_IDS)
    assert set(AFFORDANCE_BY_ACTIVITY.values()) <= AFFORDANCE_VOCABULARY


# ── b) 时间轴协议 ─────────────────────────────────────────────────────────


def test_turns_gte_fires_at_five_not_at_zero() -> None:
    situation = _patient_prompt_situation()
    state = {"spo2": 92}
    step = situation.timeline[0]

    early = apply_timeline(situation, state, turns=0, elapsed_seconds=0.0, applied=set())
    assert early.patch == {}
    assert early.utterances == ()
    assert early.events == ()
    assert early.applied == set()

    later = apply_timeline(situation, state, turns=5, elapsed_seconds=0.0, applied=set())
    assert later.patch == step.patch
    assert [utterance.speaker for utterance in later.utterances] == [PATIENT_ACTOR_ID]
    assert [utterance.say for utterance in later.utterances] == [step.say]
    assert later.events == (step.event,)
    assert later.applied == {"deteriorate"}
    assert later.next_state(state) == {**state, **step.patch}
    assert state == {"spo2": 92}  # 入参状态未被就地修改


def test_once_step_is_never_reapplied() -> None:
    situation = _patient_prompt_situation()
    first = apply_timeline(situation, {"spo2": 92}, turns=5, elapsed_seconds=0.0, applied=set())
    second = apply_timeline(situation, {"spo2": 92}, turns=9, elapsed_seconds=0.0, applied=first.applied)

    assert second.patch == {}
    assert second.utterances == ()
    assert second.events == ()
    assert second.applied == {"deteriorate"}


def test_non_once_step_refires_on_every_call() -> None:
    situation = _patient_prompt_situation()
    applied = {"recurring"}
    result = apply_timeline(situation, {}, turns=0, elapsed_seconds=120.0, applied=applied)

    assert result.patch == {"fatigue": True}
    assert result.applied == {"recurring"}  # 记账幂等；是否重发由 step.once 决定
    assert applied == {"recurring"}  # 入参集合不被就地改写


def test_unknown_when_key_is_rejected_even_when_the_step_would_not_fire() -> None:
    situation = _patient_prompt_situation()
    situation.timeline.append(TimelineStep(id="guess_intent", when={"student_confused": True}, patch={"x": 1}))

    with pytest.raises(ValueError, match="不可观测键"):
        apply_timeline(situation, {}, turns=0, elapsed_seconds=0.0, applied=set())


def test_non_numeric_threshold_is_rejected() -> None:
    situation = _patient_prompt_situation()
    situation.timeline = [TimelineStep(id="bad", when={"turns_gte": "5"}, patch={"x": 1})]

    with pytest.raises(TypeError, match="必须是数字"):
        apply_timeline(situation, {}, turns=5, elapsed_seconds=0.0, applied=set())


def test_ill_shaped_state_eq_is_rejected() -> None:
    situation = _patient_prompt_situation()
    situation.timeline = [TimelineStep(id="bad", when={"state_eq": ["disclosed"]}, patch={"x": 1})]

    with pytest.raises(TypeError, match="state_eq"):
        apply_timeline(situation, {}, turns=1, elapsed_seconds=0.0, applied=set())


def test_no_match_leaves_state_byte_identical() -> None:
    situation = _patient_prompt_situation()
    state = {"spo2": 92, "nested": {"a": 1}}
    before = deepcopy(state)
    applied = {"already_done"}

    result = apply_timeline(situation, state, turns=0, elapsed_seconds=0.0, applied=applied)

    assert (result.patch, result.utterances, result.events) == ({}, (), ())
    assert result.applied == applied
    assert result.next_state(state) == before == state
    assert applied == {"already_done"}


def test_state_eq_reads_the_input_state_and_does_not_cascade_within_one_call() -> None:
    """条件只对入参 state 求值：同一次调用里前一步写的键不会被后一步看见（不级联）。"""
    situation = _patient_prompt_situation()
    situation.timeline = [
        TimelineStep(id="set_flag", when={"turns_gte": 1}, patch={"disclosed": True}),
        TimelineStep(id="react", when={"state_eq": {"disclosed": True}}, patch={"trust": 1}, say="嗯……"),
    ]

    first = apply_timeline(situation, {}, turns=1, elapsed_seconds=0.0, applied=set())
    assert first.patch == {"disclosed": True}
    assert [step_id for step_id in sorted(first.applied)] == ["set_flag"]

    second = apply_timeline(situation, {}, turns=1, elapsed_seconds=0.0, applied=first.applied)
    assert second.patch == {}  # 入参 state 仍没有 disclosed → 不命中

    third = apply_timeline(situation, {"disclosed": True}, turns=1, elapsed_seconds=0.0, applied=first.applied)
    assert third.patch == {"trust": 1}
    assert [utterance.say for utterance in third.utterances] == ["嗯……"]


def test_later_step_wins_on_shared_patch_keys_and_patch_is_not_aliased() -> None:
    situation = _patient_prompt_situation()
    situation.timeline = [
        TimelineStep(id="a", when={"turns_gte": 1}, patch={"spo2": 90}),
        TimelineStep(id="b", when={"turns_gte": 2}, patch={"spo2": 85}),
    ]
    result = apply_timeline(situation, {}, turns=2, elapsed_seconds=0.0, applied=set())
    assert result.patch == {"spo2": 85}
    assert sorted(result.applied) == ["a", "b"]

    result.patch["spo2"] = 1
    assert situation.timeline[1].patch == {"spo2": 85}


def test_step_without_say_emits_no_utterance() -> None:
    situation = _patient_prompt_situation()
    situation.timeline = [TimelineStep(id="silent", when={"turns_gte": 1}, patch={"x": 1}, speaker=PATIENT_ACTOR_ID)]
    result = apply_timeline(situation, {}, turns=1, elapsed_seconds=0.0, applied=set())
    assert result.utterances == ()


# ── c) affordance 登记 ────────────────────────────────────────────────────


def test_affordance_report_names_unregistered_keys() -> None:
    situation = _patient_prompt_situation()
    assert affordance_report(situation, AFFORDANCE_VOCABULARY) == ["hypnosis"]
    assert affordance_report(situation, {"record"}) == ["hypnosis", "quiz"]
    assert affordance_report(situation, {affordance.key for affordance in situation.affordances}) == []


def test_real_cases_report_no_unregistered_affordance() -> None:
    for path in ALL_CASES:
        situation = situation_from_case(_load(path))
        assert affordance_report(situation, AFFORDANCE_VOCABULARY) == [], path.name


def test_decode_rejects_affordances_without_provenance() -> None:
    situation = _patient_prompt_situation()
    with pytest.raises(ValueError, match="来源标记"):
        case_from_situation(situation)
