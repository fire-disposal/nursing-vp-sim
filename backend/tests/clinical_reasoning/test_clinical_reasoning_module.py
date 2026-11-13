"""临床判断训练（V2）后端模块的聚焦测试。

覆盖本切片真正容易错的地方（都不依赖 LLM）：

1. 公有投影：只有已观察的证据下发；inquiry-only 证据不出现在"可主动获取"里；
   ``available_findings`` 的 label 是操作名而不是结果。
2. ``clinical_judgment`` Activity：``load`` 纯投影（不写库）、``observe`` 幂等、
   拒绝 inquiry-only、拒绝未知 id、``act`` 只接受 must_act。
3. 病例：``data/cases/asthma_evidence_v2.json`` 过 ``CaseDataSchema`` 与
   ``validator.validate_case``（发布门禁零 error）。
4. ``build_clinical_rubric``：锚点 → dimensions/items，raw_max = Σ item.max。
5. 确定性评分：空运行态得 0 且理由非空；"全达成"得满分且每条都有 evidence_refs。
6. LLM 输出过滤：非法 id 丢弃、披露与沟通必须有原文引用、多条自然披露如实记录。
"""

from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace

import pytest

from modules.training.clinical_reasoning import (
    build_clinical_rubric,
    build_turn_messages,
    filter_reply,
    public_state_for,
    read_state,
    score_for_record,
    seed_state,
)
from modules.training.clinical_reasoning.state import (
    STATE_KEY,
    evidence_entry,
    findings_index,
    is_inquiry_only,
    merge_state,
    objectives_of,
)
from modules.training.clinical_reasoning.tools import HANDLER, ClinicalJudgmentHandler
from modules.training.tools.base import ToolContext, ToolResult

CASE_PATH = Path(__file__).resolve().parents[2] / "data" / "cases" / "asthma_evidence_v2.json"


@pytest.fixture(scope="module")
def case_data() -> dict:
    return json.loads(CASE_PATH.read_text(encoding="utf-8"))


@pytest.fixture
def make_record(pg_session):
    """建一条真实 ``training_records`` 行（handler 的 ``patch_runtime_state`` 要读库行）。"""
    from models import Case, TrainingRecord
    from tests.conftest import ensure_school, make_user

    db = pg_session
    school = ensure_school(db)
    user = make_user(db, school=school)
    case = Case(name="临床判断测试病例", description="", difficulty=2, time_limit_minutes=30)
    db.add(case)
    db.flush()

    def _make(**overrides):
        values = {
            "user_id": user.id,
            "case_id": case.id,
            "status": "in_progress",
            "workflow_id": "clinical_reasoning",
            "runtime_state": {},
        }
        values.update(overrides)
        record = TrainingRecord(**values)
        db.add(record)
        db.flush()
        return record

    return _make


# ── 病例结构 ───────────────────────────────────────────────────────────────


def test_case_passes_schema_and_publish_gate(case_data):
    from modules.cases.validator import validate_case
    from schemas.case_schema import validate_case_data

    validate_case_data(case_data, strict=True)
    report = validate_case(case_data)
    assert report.ok(), [f"{i.field}: {i.message}" for i in report.errors]
    assert case_data["workflow"] == "clinical_reasoning"


def test_case_has_initial_inquiry_and_exam_evidence(case_data):
    index = findings_index(case_data)
    visible = set(case_data["initial"]["visible_findings"])
    hidden = set(case_data["initial"]["hidden_findings"])
    assert visible
    assert hidden
    assert not (visible & hidden)
    # 必须有"只能问出来"的证据，也必须有"只能观察出来"的证据
    assert any(is_inquiry_only(f) for f in index.values())
    assert any(not is_inquiry_only(f) and f["id"] in hidden for f in index.values())


# ── 公有投影 ───────────────────────────────────────────────────────────────


def test_projection_only_exposes_observed_evidence(case_data):
    state = seed_state(case_data, None)
    public = public_state_for(case_data, {STATE_KEY: state}, revision=4)
    visible = set(case_data["initial"]["visible_findings"])
    assert {e["finding_id"] for e in public["evidence"]} == visible
    assert public["revision"] == 4
    # 未观察的隐藏证据绝不下发
    hidden = set(case_data["initial"]["hidden_findings"])
    assert not ({e["finding_id"] for e in public["evidence"]} & hidden)


def test_available_findings_exclude_inquiry_and_label_is_action(case_data):
    public = public_state_for(case_data, {STATE_KEY: seed_state(case_data, None)}, revision=0)
    available = {item["finding_id"]: item for item in public["available_findings"]}

    index = findings_index(case_data)
    for fid in available:
        assert not is_inquiry_only(index[fid]), f"{fid} 只能问出来，不该出现在可获取面板"

    auscultation = available["f.auscultation"]
    # label 是操作名（"听诊双肺"），不是结果（"双肺弥漫哮鸣音…"）
    assert auscultation["label"] == "听诊双肺"
    assert "哮鸣" not in auscultation["label"]
    assert auscultation["action"]


def test_projection_objectives_reflect_state(case_data):
    state = seed_state(case_data, None)
    public = public_state_for(case_data, {STATE_KEY: state}, revision=0)
    objectives = public["objectives"]
    assert objectives["notice_count"] == len(case_data["initial"]["visible_findings"])
    assert objectives["notice_total"] == len(case_data["findings"])
    assert [item["id"] for item in objectives["must_act"]] == [
        item["id"] for item in case_data["objectives"]["must_act"]
    ]
    assert all(item["completed"] is False for item in objectives["must_act"])
    # 投影不下发 must_notice 之外的评分信息（没有权重/锚点字段）
    assert "rubric" not in public
    assert "weight" not in json.dumps(public)


def test_read_state_accepts_bare_and_wrapped(case_data):
    state = seed_state(case_data, None)
    assert read_state({STATE_KEY: state}) == read_state(state)


# ── Activity handler ───────────────────────────────────────────────────────


def _ctx(case_data, db, record):
    from models import User

    user = db.get(User, record.user_id)
    return ToolContext(record=record, case_data=case_data, current_user=user, db=db)


def test_load_is_pure_projection(case_data, pg_session, make_record):
    db = pg_session
    record = make_record(runtime_state={})
    ctx = _ctx(case_data, db, record)

    import asyncio

    result = asyncio.run(HANDLER.handle("load", {}, ctx))
    assert isinstance(result, ToolResult)
    assert result.ok
    # 开场证据看得到
    assert len(result.data["state"]["evidence"]) == len(case_data["initial"]["visible_findings"])
    # 但 load **不得**写库（tools.service 对读命令不提交）
    db.refresh(record)
    assert read_state(record.runtime_state)["evidence"] == []


def test_observe_is_idempotent_and_seeds_initial(case_data, pg_session, make_record):
    import asyncio

    db = pg_session
    record = make_record(runtime_state={})
    ctx = _ctx(case_data, db, record)

    first = asyncio.run(HANDLER.handle("observe", {"finding_id": "f.spo2"}, ctx))
    assert first.ok
    db.refresh(record)
    stored = read_state(record.runtime_state)
    ids = [item["finding_id"] for item in stored["evidence"]]
    assert "f.spo2" in ids
    # 首次真实写入补齐了开场证据
    for fid in case_data["initial"]["visible_findings"]:
        assert fid in ids

    count = len(ids)
    second = asyncio.run(HANDLER.handle("observe", {"finding_id": "f.spo2"}, ctx))
    assert second.ok
    db.refresh(record)
    assert len(read_state(record.runtime_state)["evidence"]) == count


def test_observe_rejects_inquiry_only(case_data, pg_session, make_record):
    import asyncio

    from core.exceptions import ValidationError

    db = pg_session
    record = make_record(runtime_state={})
    ctx = _ctx(case_data, db, record)
    with pytest.raises(ValidationError):
        asyncio.run(HANDLER.handle("observe", {"finding_id": "f.trigger_cat"}, ctx))


def test_observe_rejects_unknown(case_data, pg_session, make_record):
    import asyncio

    from core.exceptions import ValidationError

    db = pg_session
    record = make_record(runtime_state={})
    ctx = _ctx(case_data, db, record)
    with pytest.raises(ValidationError):
        asyncio.run(HANDLER.handle("observe", {"finding_id": "f.nope"}, ctx))


def test_act_only_accepts_must_act(case_data, pg_session, make_record):
    import asyncio

    from core.exceptions import ValidationError

    db = pg_session
    record = make_record(runtime_state={})
    ctx = _ctx(case_data, db, record)

    # a.oxygen 要求先拿到 f.spo2
    asyncio.run(HANDLER.handle("observe", {"finding_id": "f.spo2"}, ctx))

    ok = asyncio.run(HANDLER.handle("act", {"objective_id": "a.oxygen"}, ctx))
    assert ok.ok
    db.refresh(record)
    assert "a.oxygen" in read_state(record.runtime_state)["completed_objectives"]

    # must_notice / must_communicate 不是动作
    with pytest.raises(ValidationError):
        asyncio.run(HANDLER.handle("act", {"objective_id": "n.spo2"}, ctx))
    with pytest.raises(ValidationError):
        asyncio.run(HANDLER.handle("act", {"objective_id": "c.calming"}, ctx))

    again = asyncio.run(HANDLER.handle("act", {"objective_id": "a.oxygen"}, ctx))
    assert again.ok
    db.refresh(record)
    assert read_state(record.runtime_state)["completed_objectives"].count("a.oxygen") == 1


def test_act_without_required_evidence_is_rejected_and_writes_nothing(case_data, pg_session, make_record):
    """零证据连点：没有任何前置证据时，行动被拒且运行态不留痕。"""
    import asyncio

    from core.exceptions import ValidationError

    db = pg_session
    record = make_record(runtime_state={})
    ctx = _ctx(case_data, db, record)

    with pytest.raises(ValidationError) as exc:
        asyncio.run(HANDLER.handle("act", {"objective_id": "a.nebulizer"}, ctx))

    detail = str(exc.value.detail)
    # 缺的两条证据都以可读 label 点名（不是裸 id）
    assert "SpO2 89%（室内空气）" in detail
    assert "双肺弥漫哮鸣音" in detail

    db.refresh(record)
    assert read_state(record.runtime_state)["completed_objectives"] == []
    # 被拒的 act 不补开场证据：state 仍为空（没有半截写入）
    assert read_state(record.runtime_state)["evidence"] == []


def test_act_after_required_evidence_is_observed(case_data, pg_session, make_record):
    """先拿齐前置证据，行动才可执行；只拿一半仍被拒。"""
    import asyncio

    from core.exceptions import ValidationError

    db = pg_session
    record = make_record(runtime_state={})
    ctx = _ctx(case_data, db, record)

    asyncio.run(HANDLER.handle("observe", {"finding_id": "f.spo2"}, ctx))
    with pytest.raises(ValidationError) as exc:
        asyncio.run(HANDLER.handle("act", {"objective_id": "a.nebulizer"}, ctx))
    assert "双肺弥漫哮鸣音" in str(exc.value.detail)
    assert "SpO2 89%（室内空气）" not in str(exc.value.detail)

    asyncio.run(HANDLER.handle("observe", {"finding_id": "f.auscultation"}, ctx))
    ok = asyncio.run(HANDLER.handle("act", {"objective_id": "a.nebulizer"}, ctx))
    assert ok.ok
    db.refresh(record)
    assert "a.nebulizer" in read_state(record.runtime_state)["completed_objectives"]


def test_act_without_requirements_needs_no_evidence(case_data, pg_session, make_record):
    """a.position 不要求额外证据：开场即可完成。"""
    import asyncio

    db = pg_session
    record = make_record(runtime_state={})
    ctx = _ctx(case_data, db, record)

    ok = asyncio.run(HANDLER.handle("act", {"objective_id": "a.position"}, ctx))
    assert ok.ok
    db.refresh(record)
    assert "a.position" in read_state(record.runtime_state)["completed_objectives"]


def test_publish_gate_rejects_unknown_requires_findings(case_data):
    """未知 requires_findings 引用过不了发布门禁（引用悬空 → error）。"""
    from modules.cases.validator import validate_case

    broken = json.loads(json.dumps(case_data))
    broken["objectives"]["must_act"][0]["requires_findings"] = ["f.nope"]
    result = validate_case(broken)
    assert result.errors
    assert any("f.nope" in err.message for err in result.errors)


def test_publish_gate_rejects_unreachable_requires_findings(case_data):
    """前置证据存在但拿不到（不在 initial 且无途径）→ 该行动永远不可完成，也是 error。"""
    from modules.cases.validator import validate_case

    broken = json.loads(json.dumps(case_data))
    broken["findings"].append({"id": "f.orphan", "label": "孤立证据", "kind": "lab", "critical": False})
    broken["objectives"]["must_act"][0]["requires_findings"] = ["f.orphan"]
    result = validate_case(broken)
    assert any("f.orphan" in err.message and "没有获取途径" in err.message for err in result.errors)


def test_projection_reports_available_and_missing_evidence(case_data):
    """前端可读缺失证据 label：未观察时 available=False 且带可读 missing_findings。"""
    state = seed_state(case_data, None)
    public = public_state_for(case_data, {STATE_KEY: state}, revision=0)
    by_id = {item["id"]: item for item in public["objectives"]["must_act"]}

    assert by_id["a.oxygen"]["available"] is False
    assert by_id["a.oxygen"]["missing_findings"] == ["SpO2 89%（室内空气）"]
    assert by_id["a.nebulizer"]["missing_findings"] == [
        "SpO2 89%（室内空气）",
        "双肺弥漫哮鸣音，呼气相延长，呼气末几乎听不到呼吸音",
    ]
    # 无需前置证据的行动始终可执行
    assert by_id["a.position"]["available"] is True
    assert by_id["a.position"]["missing_findings"] == []

    index = findings_index(case_data)
    for fid in ("f.spo2", "f.auscultation"):
        state = merge_state(base=state, evidence=[evidence_entry(index[fid], source="observation")])
    public = public_state_for(case_data, {STATE_KEY: state}, revision=0)
    by_id = {item["id"]: item for item in public["objectives"]["must_act"]}
    assert by_id["a.oxygen"]["available"] is True
    assert by_id["a.nebulizer"]["missing_findings"] == []


def test_code_requires_findings_exist_in_case(case_data):
    """哮喘病例本身的前置证据声明：氧气 → f.spo2；雾化 → f.spo2 + f.auscultation；体位 → 无。"""
    index = findings_index(case_data)
    must_act = {item["id"]: item for item in objectives_of(case_data)["must_act"]}
    assert must_act["a.oxygen"]["requires_findings"] == ["f.spo2"]
    assert must_act["a.nebulizer"]["requires_findings"] == ["f.spo2", "f.auscultation"]
    assert must_act["a.position"]["requires_findings"] == []
    for item in must_act.values():
        assert set(item["requires_findings"]) <= set(index)


def test_handler_contract():
    assert ClinicalJudgmentHandler.tool_name == "clinical_judgment"
    assert HANDLER.actions == frozenset({"load", "observe", "act"})


# ── rubric 规范化 ──────────────────────────────────────────────────────────


def test_build_clinical_rubric_normalizes_anchors(case_data):
    rubric = build_clinical_rubric(case_data)
    assert rubric["raw_scale"] == 2
    items = [item for dim in rubric["dimensions"] for item in dim["items"]]
    assert len(items) == len(case_data["rubric"]["anchors"])
    assert rubric["raw_max"] == pytest.approx(sum(item["max"] for item in items))
    for item in items:
        assert item["rule"] in {"finding_observed", "objective_met", "action_taken", "communicated"}
        assert set(item["anchors"]) == {"0", "1", "2"}
        assert item["max"] > 0


def test_build_clinical_rubric_without_anchors_is_empty():
    rubric = build_clinical_rubric({"name": "empty"})
    assert rubric["dimensions"] == []
    assert rubric["raw_max"] == 0


# ── 确定性评分 ─────────────────────────────────────────────────────────────


class _FakeRecord:
    def __init__(self, case_snapshot: dict, runtime_state: dict | None = None) -> None:
        self.case_snapshot = case_snapshot
        self.runtime_state = runtime_state or {}


def test_score_of_empty_state_is_zero_with_real_reasons(case_data):
    result = score_for_record(_FakeRecord(case_data, {}))
    assert result["total_score"] == 0
    assert result["raw_total"] == 0
    assert result["applicable_raw_max"] > 0
    items = [item for dim in result["raw_detail_scores"].values() for item in dim["items"]]
    assert items
    assert all(item["reason"] for item in items)
    assert all(item["status"] == "scored" for item in items)


def _fully_completed_state(case_data):
    index = findings_index(case_data)
    state = seed_state(case_data, None)
    for fid, finding in index.items():
        if not is_inquiry_only(finding):
            state = merge_state(base=state, evidence=[evidence_entry(finding, source="observation")])
    for item in objectives_of(case_data)["must_act"]:
        state = merge_state(base=state, completed=[item["id"]])
    for item in objectives_of(case_data)["must_communicate"]:
        state = merge_state(base=state, communicated=[item["id"]])
    for fid, finding in index.items():
        if is_inquiry_only(finding):
            state = merge_state(base=state, evidence=[evidence_entry(finding, source="patient", message_id=11)])
    return {STATE_KEY: state}


def test_score_of_full_completion_is_max(case_data):
    result = score_for_record(_FakeRecord(case_data, _fully_completed_state(case_data)))
    assert result["raw_total"] == pytest.approx(result["applicable_raw_max"])
    assert result["total_score"] == 100
    items = [item for dim in result["raw_detail_scores"].values() for item in dim["items"]]
    assert all(item["score"] == item["max"] for item in items)
    # 每条都得有可追溯的证据/动作引用，而不是空数组
    assert all(item["evidence_refs"] for item in items)


def test_score_detail_scores_shape_matches_record_detail(case_data):
    result = score_for_record(_FakeRecord(case_data, _fully_completed_state(case_data)))
    for dim in result["detail_scores"].values():
        assert {"id", "name", "score", "max", "items"} <= set(dim)
        for item in dim["items"]:
            assert {"id", "name", "score", "max", "reason"} <= set(item)


# ── LLM 输出过滤 ───────────────────────────────────────────────────────────


def test_filter_drops_illegal_and_non_inquiry_ids(case_data):
    filtered = filter_reply(
        {
            "reply": "家里新养了只猫……",
            # f.spo2 是 exam 途径，f.not_exist 不存在
            "disclosed_findings": [
                {"id": "f.trigger_cat", "quote": "新养了只猫"},
                {"id": "f.spo2", "quote": "新养了只猫"},
                {"id": "f.not_exist", "quote": "新养了只猫"},
            ],
        },
        case_data=case_data,
        runtime_state={},
        student_input="",
    )
    assert filtered.disclosed_ids == ["f.trigger_cat"]


def test_filter_records_every_quote_anchored_disclosure_without_quantity_cap(case_data):
    filtered = filter_reply(
        {
            "reply": "家里新养了猫……我三个月前停了吸入激素……也担心它会让人发胖。",
            "disclosed_findings": [
                {"id": "f.trigger_cat", "quote": "新养了猫"},
                {"id": "f.local_rx_inhaled", "quote": "三个月前停了吸入激素"},
                {"id": "f.hormone_concern", "quote": "担心它会让人发胖"},
            ],
        },
        case_data=case_data,
        runtime_state={},
        student_input="",
    )
    assert filtered.disclosed_ids == ["f.trigger_cat", "f.local_rx_inhaled", "f.hormone_concern"]


def test_filter_only_accepts_communication_supported_by_student_input(case_data):
    filtered = filter_reply(
        {
            "reply": "好……我知道你一直在。",
            "communicated_objectives": [
                {"id": "c.calming", "quote": "我会一直在旁边处理"},
                {"id": "a.oxygen", "quote": "我会一直在旁边处理"},
                {"id": "c.not_exist", "quote": "我会一直在旁边处理"},
            ],
        },
        case_data=case_data,
        runtime_state={},
        student_input="我会一直在旁边处理，你先按我的节奏呼吸。",
    )
    assert filtered.communicated_ids == ["c.calming"]


def test_filter_rejects_ids_without_matching_source_quote(case_data):
    filtered = filter_reply(
        {
            "reply": "嗯……",
            "disclosed_findings": [{"id": "f.trigger_cat", "quote": "家里新养了猫"}],
            "communicated_objectives": [{"id": "c.calming", "quote": "我会一直在旁边处理"}],
        },
        case_data=case_data,
        runtime_state={},
        student_input="你现在感觉怎么样？",
    )
    assert filtered.disclosed_ids == []
    assert filtered.communicated_ids == []


def test_filter_does_not_repeat_already_observed(case_data):
    state = seed_state(case_data, None)
    state = merge_state(
        base=state,
        evidence=[evidence_entry(findings_index(case_data)["f.trigger_cat"], source="patient", message_id=3)],
    )
    filtered = filter_reply(
        {
            "reply": "刚说过了，家里新养了猫……",
            "disclosed_findings": [{"id": "f.trigger_cat", "quote": "家里新养了猫"}],
        },
        case_data=case_data,
        runtime_state={STATE_KEY: state},
        student_input="",
    )
    assert filtered.disclosed_ids == []


def test_filter_empty_reply(case_data):
    filtered = filter_reply({"disclosed_findings": []}, case_data=case_data, runtime_state={}, student_input="")
    assert filtered.reply == ""


def test_patient_prompt_contains_full_background_and_id_mapping_without_clinical_notes(case_data):
    """患者既有完整生活背景，也能把自然表达准确映射到证据 id。"""
    ctx = SimpleNamespace(
        case_data=case_data,
        record=SimpleNamespace(runtime_state={}),
        messages=[],
        student_input="发作前在做什么？",
    )

    messages = build_turn_messages(ctx)
    system = messages[0]["content"]

    assert "发作前正在换猫砂" in system
    assert "[f.trigger_cat]" in system
    assert "外卖配送员" in system
    assert "舍不得送走" in system
    assert "重症提示" not in system
    assert "本次发作的根源之一" not in system


def test_patient_prompt_separates_stable_persona_from_observed_actions(case_data):
    """现场状态随回合变化，但人设与病例前缀保持逐字节稳定。"""
    ctx = SimpleNamespace(
        case_data=case_data,
        record=SimpleNamespace(runtime_state={}),
        messages=[],
        student_input="现在给你吸氧，感觉怎么样？",
    )
    initial = build_turn_messages(ctx)

    state = seed_state(case_data, None)
    state = merge_state(
        base=state,
        evidence=[evidence_entry(findings_index(case_data)["f.spo2"], source="observation")],
        completed=["a.oxygen"],
        communicated=["c.calming"],
    )
    ctx.record.runtime_state = {STATE_KEY: state}
    updated = build_turn_messages(ctx)

    assert updated[0]["content"] == initial[0]["content"]
    turn_state = updated[-2]["content"]
    assert "SpO2 89%" in turn_state
    assert "启动吸氧" in turn_state
    assert "安抚患者的恐惧" in turn_state
    assert "未吸氧状态下的低氧血症" not in turn_state
    assert updated[-1]["content"].startswith("护士的发言或动作：")
