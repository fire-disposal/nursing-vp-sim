"""学生侧回合 API 回归（新机制）：**解析 → 结算 → 演出 → 原子提交** 的消费者可见边界。

只覆盖真实行为不变量（docs/23 §11.1）：两入口同结算、澄清与提示不推进、未建模诚实、
幂等与序号冲突、断流查询、学生响应不含内部字段。旧机制的多步循环/归属回填/DM 写世界
等断言随实现删除，不再重新钉住。
"""

from __future__ import annotations

import json
from typing import Any

import pytest
from fastapi.testclient import TestClient

from core.database import get_db
from core.security import get_current_user
from models.scenario_training import StEvent, StSession
from modules.scenario_training import pack_loader
from modules.scenario_training import router as scenario_router

PACK_KEY = "sputum-ineffective"


class _FakeUser:
    def __init__(self, permissions: set[str] | None = None, user_id: int = 4242) -> None:
        self.id = user_id
        self.role_id = 1
        self.token_version = 1
        self.role = type("_Role", (), {"name": "student"})()
        self._permissions = permissions or {"scenario_training"}

    def has_permission(self, key: str) -> bool:
        return key in self._permissions


async def _no_rate_limit(*_args: object, **_kwargs: object) -> None:
    return None


class _ScriptedLLM:
    """解析/演出两阶段各自可脚本化；演出阶段**不可能**写世界（这正是要证明的边界）。"""

    def __init__(self) -> None:
        self.intent: dict[str, Any] = {"kind": "action", "affordance_id": None, "utterance": ""}
        self.delivery: dict[str, Any] = {
            "messages": [{"speaker": None, "text": "监护仪还在响。"}],
            "hints": [],
            "assets": [],
            "highlights": [],
        }
        self.calls: list[list[dict[str, str]]] = []

    async def call(self, messages: list[dict[str, str]], **_: Any) -> str:
        self.calls.append(messages)
        system = messages[0]["content"] if messages else ""
        payload = self.intent if "意图解析器" in system else self.delivery
        return json.dumps(payload, ensure_ascii=False)


@pytest.fixture
def api(pg_session, monkeypatch):
    from main import app

    monkeypatch.setattr(scenario_router, "SCENARIO_TRAINING_ENABLED", True)
    monkeypatch.setattr(scenario_router, "check_scenario_open_limit", _no_rate_limit)
    monkeypatch.setattr(scenario_router, "check_scenario_action_limit", _no_rate_limit)
    pack_loader.reset_cache()
    pack = pack_loader.load_pack_file(PACK_KEY)
    _, revision, _ = pack_loader.install(pg_session, pack)
    holder = {"user": _FakeUser(), "llm": _ScriptedLLM()}
    before = dict(app.dependency_overrides)

    def _override_db():
        yield pg_session

    app.dependency_overrides[get_db] = _override_db
    app.dependency_overrides[get_current_user] = lambda: holder["user"]
    original = getattr(app.state, "llm_client", None)
    app.state.llm_client = holder["llm"]
    try:
        yield TestClient(app), holder, pg_session, pack, revision
    finally:
        app.dependency_overrides.clear()
        app.dependency_overrides.update(before)
        app.state.llm_client = original
        pack_loader.reset_cache()


def _open(client, holder, revision) -> tuple[int, int]:
    holder["user"] = _FakeUser()
    response = client.post("/api/scenario/sessions", json={"revision_id": revision.id})
    assert response.status_code == 200, response.text
    body = response.json()
    return body["session_id"], body["view"]["session"]["seq"]


def _turn(client, session_id: int, seq: int, **body: Any):
    payload = {"request_id": body.pop("request_id", "r1"), "expected_seq": seq, **body}
    return client.post(f"/api/scenario/sessions/{session_id}/turns", json=payload)


def test_opening_and_structured_turn_settle_once(api) -> None:
    """开场（turn 0）→ 结构化动作（turn 1）：结算差量来自包声明，演出不写世界。"""
    client, holder, db, _pack, revision = api
    session_id, seq = _open(client, holder, revision)
    assert seq == 1
    llm: _ScriptedLLM = holder["llm"]
    llm.delivery = {"messages": [{"speaker": "patient", "text": "……"}], "hints": [], "assets": [], "highlights": []}

    calls_before = len(llm.calls)
    result = _turn(client, session_id, seq, kind="action", affordance_id="auscultate")
    assert result.status_code == 200, result.text
    body = result.json()
    assert body["outcome"] == "performed"
    assert body["seq"] == 2
    # `auscultate` 没有声明 time_cost：观察不消耗时间（信息获取理所当然）
    assert body["time_cost"] == 0
    assert body["turn"] == 0
    # 两阶段：结构化动作只调演出一次（解析阶段由平台直接构造，不花模型）
    assert len(llm.calls) - calls_before == 1
    events = db.query(StEvent).filter(StEvent.session_id == session_id).all()
    assert [event.kind for event in events] == ["session_opened", "turn_committed"]
    # 包声明的揭示确实发生了，且演出**没有**写世界的通道
    assert "c_left_absent" in events[1].payload["reveals"]
    assert all("effects" not in message for message in body["messages"])
    assert body["view"]["session"]["seq"] == 2


def test_free_speech_and_button_reach_the_same_settlement(api) -> None:
    """同意图两入口同结算：各自新开一局，说话（言语动作）与按按钮得到相同效果/揭示/时间代价。"""
    client, holder, _db, _pack, revision = api
    holder["llm"].intent = {"kind": "action", "affordance_id": "call_doctor", "utterance": ""}
    free_session, free_seq = _open(client, holder, revision)
    free = _turn(client, free_session, free_seq, kind="speech", text="我喊一句：医生过来看一下！")
    assert free.status_code == 200, free.text

    button_session, button_seq = _open(client, holder, revision)
    button = _turn(client, button_session, button_seq, kind="action", affordance_id="call_doctor")
    assert button.status_code == 200, button.text

    assert free.json()["outcome"] == button.json()["outcome"]
    assert free.json()["time_cost"] == button.json()["time_cost"] != 0
    assert free.json()["turn"] == button.json()["turn"]


def test_speech_cannot_be_attributed_to_a_physical_action(api) -> None:
    """说话**绝不**等于已完成物理处置：物理动作不能被说话通道归属（本轮按交流结算）。"""
    client, holder, _db, _pack, revision = api
    session_id, seq = _open(client, holder, revision)
    holder["llm"].intent = {"kind": "action", "affordance_id": "auscultate", "utterance": ""}
    result = _turn(client, session_id, seq, kind="speech", text="我先听一下两肺。")
    assert result.status_code == 200, result.text
    body = result.json()
    assert body["outcome"] == "speech"
    assert body["time_cost"] == 0
    state = body["view"]["board"]["sections"]
    assert state  # 视图照常返回（没有副作用）


def test_speech_to_unreachable_actor_is_blocked_and_consumes_a_turn(api) -> None:
    """已知但当下不可达的实际尝试 = blocked（消耗一个回合），且**不静默换人**。"""
    client, holder, db, _pack, _revision = api
    pack = pack_loader.load_pack_file("night-call-decision")
    _, revision, _ = pack_loader.install(db, pack)
    session_id, seq = _open(client, holder, revision)
    holder["llm"].intent = {
        "kind": "speech",
        "target": {"kind": "actor", "id": "patient"},
        "utterance": "",
    }
    assert pack.actor("patient").presence.value == "inaccessible"
    blocked = _turn(
        client,
        session_id,
        seq,
        kind="speech",
        text="我跟床上那位患者说：你先别动。",
        target={"kind": "actor", "id": "patient"},
    )
    assert blocked.status_code == 200, blocked.text
    assert blocked.json()["outcome"] == "blocked"
    # 这次尝试**没有声明时间代价**（只是说话）→ 时间不前进；世界如实回应"够不到"
    assert blocked.json()["time_cost"] == 0
    assert blocked.json()["turn"] == 0
    notices = [message for message in blocked.json()["messages"] if message["role"] == "system"]
    assert notices
    assert notices[0]["kind"] == "blocked"


def test_unknown_target_and_affordance_are_request_errors_without_a_turn(api) -> None:
    """形状问题（未知目标/动作）→ 422，**不消耗回合、不写世界**；错误只能有 code+message。"""
    client, holder, db, _pack, revision = api
    session_id, seq = _open(client, holder, revision)
    bad_target = _turn(client, session_id, seq, kind="speech", text="喂？", target={"kind": "actor", "id": "nobody"})
    assert bad_target.status_code == 422
    detail = bad_target.json()["detail"]
    assert detail == {"code": "unknown_target", "message": detail["message"]}
    assert "problems" not in json.dumps(bad_target.json())
    bad_action = _turn(client, session_id, seq, kind="action", affordance_id="teleport")
    assert bad_action.status_code == 422
    assert bad_action.json()["detail"]["code"] == "unknown_affordance"
    assert db.query(StEvent).filter(StEvent.session_id == session_id).count() == 1


def test_multi_target_action_asks_for_the_object_without_advancing(api) -> None:
    """多对象歧义 → 澄清（确定性、无模型调用、不推进）；给了对象才结算。"""
    client, holder, db, _pack, revision = api
    pack = pack_loader.load_pack_file("two-beds-priority")
    _, beds_revision, _ = pack_loader.install(db, pack)
    session_id, seq = _open(client, holder, beds_revision)
    before_calls = len(holder["llm"].calls)
    ambiguous = _turn(client, session_id, seq, kind="action", affordance_id="reassure_a")
    assert ambiguous.status_code == 200, ambiguous.text
    body = ambiguous.json()
    assert body["outcome"] == "clarification"
    assert body["turn"] == 0
    assert body["seq"] == seq + 1  # 澄清提交事件但**不推进回合**
    assert any(message["kind"] == "clarification" for message in body["messages"])
    assert len(holder["llm"].calls) == before_calls  # 确定性澄清：一次模型调用都不花

    resolved = _turn(
        client,
        session_id,
        body["seq"],
        request_id="r2",
        kind="action",
        affordance_id="reassure_a",
        target={"kind": "actor", "id": "bed_a"},
    )
    assert resolved.status_code == 200, resolved.text
    assert resolved.json()["outcome"] == "performed"
    assert resolved.json()["time_cost"] == 1  # 包声明 reassure_a = 1
    assert resolved.json()["turn"] == 1


def test_hint_is_read_only_and_does_not_advance_the_turn(api) -> None:
    """求提示：走只读交付路径（记录 + 来源），**不推进世界、不消耗回合**。"""
    client, holder, db, _pack, revision = api
    session_id, seq = _open(client, holder, revision)
    holder["llm"].delivery = {
        "messages": [{"speaker": None, "text": "先想想眼前哪一条信息最不一致。"}],
        "hints": ["先想想眼前哪一条信息最不一致。"],
        "assets": [],
        "highlights": [],
    }
    hinted = _turn(client, session_id, seq, kind="hint", text="我该先想什么？")
    assert hinted.status_code == 200, hinted.text
    body = hinted.json()
    assert body["outcome"] == "hint"
    assert body["turn"] == 0
    assert body["seq"] == seq + 1
    kinds = [
        event.kind for event in db.query(StEvent).filter(StEvent.session_id == session_id).order_by(StEvent.seq).all()
    ]
    assert kinds == ["session_opened", "hint_requested"]
    assert any(message["kind"] == "hint" for message in body["messages"])


def test_unmodeled_attempt_is_honest_and_not_a_clinical_error(api) -> None:
    """未建模尝试 → `unmodeled` + 引擎直出说明；不算临床错误、不找个最接近的动作蒙过去。"""
    client, holder, _db, _pack, revision = api
    session_id, seq = _open(client, holder, revision)
    holder["llm"].intent = {"kind": "action", "affordance_id": None, "utterance": ""}
    result = _turn(client, session_id, seq, kind="action", text="我要给他做气管插管。")
    assert result.status_code == 200, result.text
    body = result.json()
    assert body["outcome"] == "unmodeled"
    system = [message for message in body["messages"] if message["role"] == "system"]
    assert system
    assert "没有建模" in system[0]["text"]
    assert body["view"]["session"]["lost"] is False  # 未建模不触发恶化


def test_same_request_id_is_idempotent_and_different_input_is_rejected(api) -> None:
    """同 id 同输入 → 原结果、**至多提交一次**；同 id 异输入 → 409 request_conflict。"""
    client, holder, db, _pack, revision = api
    session_id, seq = _open(client, holder, revision)
    first = _turn(client, session_id, seq, request_id="same", kind="action", affordance_id="suction")
    assert first.status_code == 200, first.text
    events_after_first = db.query(StEvent).filter(StEvent.session_id == session_id).count()

    again = _turn(client, session_id, seq, request_id="same", kind="action", affordance_id="suction")
    assert again.status_code == 200, again.text
    assert again.json() == first.json()  # 原结果（连视图都一样）
    assert db.query(StEvent).filter(StEvent.session_id == session_id).count() == events_after_first

    conflict = _turn(client, session_id, seq, request_id="same", kind="action", affordance_id="call_doctor")
    assert conflict.status_code == 409
    assert conflict.json()["detail"]["code"] == "request_conflict"
    assert db.query(StEvent).filter(StEvent.session_id == session_id).count() == events_after_first


def test_stale_expected_seq_is_rejected_with_current_seq(api) -> None:
    """过期基线 → 409 session_conflict 且带 current_seq；不写世界。"""
    client, holder, db, _pack, revision = api
    session_id, seq = _open(client, holder, revision)
    assert _turn(client, session_id, seq, kind="action", affordance_id="suction").status_code == 200
    stale = _turn(client, session_id, seq, request_id="r2", kind="action", affordance_id="measure_spo2")
    assert stale.status_code == 409
    detail = stale.json()["detail"]
    assert detail["code"] == "session_conflict"
    assert detail["current_seq"] == seq + 1
    assert db.query(StEvent).filter(StEvent.session_id == session_id).count() == seq + 1


def test_request_lookup_states_after_a_lost_response(api) -> None:
    """提交后断流：按 request_id 取回原结果；没提交过的 id 是 `unknown`（不是失败）。"""
    client, holder, _db, _pack, revision = api
    session_id, seq = _open(client, holder, revision)
    committed = _turn(client, session_id, seq, request_id="lost", kind="action", affordance_id="auscultate")
    assert committed.status_code == 200
    lookup = client.get(f"/api/scenario/sessions/{session_id}/requests/lost")
    assert lookup.status_code == 200
    body = lookup.json()
    assert body["state"] == "committed"
    assert body["kind"] == "turn"
    assert body["result"] == committed.json()
    assert body["resend_safe"] is True

    unknown = client.get(f"/api/scenario/sessions/{session_id}/requests/never").json()
    assert unknown["state"] == "unknown"
    assert unknown["resend_safe"] is True
    assert unknown["result"] is None
    assert unknown["error"] is None


def test_close_is_idempotent_and_report_leads_with_the_experience(api) -> None:
    """结束：报告先给结局/关键回合/反思，分数在 `assessment`；同 id 重复关闭返回同一结果。"""
    client, holder, db, _pack, revision = api
    session_id, seq = _open(client, holder, revision)
    seq = _turn(client, session_id, seq, kind="action", affordance_id="suction").json()["seq"]
    closed = client.post(f"/api/scenario/sessions/{session_id}/close", json={"request_id": "c1", "expected_seq": seq})
    assert closed.status_code == 200, closed.text
    report = closed.json()["report"]
    assert set(report) == {"pack", "outcome", "key_turns", "reflection", "assessment", "timeline"}
    assert report["outcome"]["status"] in ("lost", "ended_by_student")
    assert report["key_turns"]
    assert report["key_turns"][0]["turn"] >= 0  # 时间单位累计值
    assert report["assessment"]["score"]["rate"] is not None
    assert "problems" not in json.dumps(closed.json())

    again = client.post(f"/api/scenario/sessions/{session_id}/close", json={"request_id": "c1", "expected_seq": 999})
    assert again.status_code == 200
    assert again.json() == closed.json()
    assert db.get(StSession, session_id).status == "completed"


def test_student_view_never_carries_internal_fields(api) -> None:
    """学生响应不含拒绝诊断、教学关注点、隐藏真相与内部提案。"""
    client, holder, _db, _pack, revision = api
    session_id, seq = _open(client, holder, revision)
    body = _turn(client, session_id, seq, kind="action", affordance_id="suction").json()
    serialized = json.dumps(body, ensure_ascii=False)
    for forbidden in ("teaching_focus", "truth", "problems", "a_see_the_plug", "admired", "social_updates"):
        assert forbidden not in serialized
    assert set(body["view"]) == {
        "session",
        "pack",
        "situation",
        "actors",
        "hud",
        "messages",
        "affordances",
        "free_input",
        "timeline",
        "dims",
        "nudges",
        "assets",
        "images",
        "board",
        "devices",
        "panels",
    }
    # 每条消息都有稳定 id（接续与去重按它，不按文案）
    assert all(message["id"].startswith("m") for message in body["view"]["messages"])


def test_person_state_proposal_requires_a_qualified_key(api) -> None:
    """人物状态提案：全限定键生效且受上限约束；裸键被拒并记账（不静默生效）。"""
    client, holder, _db, pack, revision = api
    session_id, seq = _open(client, holder, revision)
    holder["llm"].intent = {
        "kind": "speech",
        "social_updates": [
            {"key": "comfort", "op": "incr", "value": 1},
            {"key": "patient.comfort", "op": "incr", "value": 1},
        ],
    }
    _turn(client, session_id, seq, kind="speech", text="我轻声跟他说：我们一步一步来。")
    from modules.scenario_training.runtime import session as session_mod

    world = session_mod.replay(_db, session_id, pack)
    assert world.state["patient.comfort"] == pack.state_keys["patient.comfort"] + 1
    problems = [
        problem
        for event in session_mod.load_events(_db, session_id)
        for problem in (event["payload"] or {}).get("problems") or []
    ]
    assert any(problem.startswith("social_key_not_writable:comfort") for problem in problems)


def test_time_ruler_only_moves_on_declared_cost(api) -> None:
    """时间尺子：说话/观察不花时间；只有声明 `time_cost` 的动作让 `turn` 前进。"""
    client, holder, _db, _pack, revision = api
    session_id, seq = _open(client, holder, revision)
    # 纯交流 ×3：turn 不变、seq 每次 +1
    for index in range(3):
        spoke = _turn(client, session_id, seq, request_id=f"s{index}", kind="speech", text="他还在喘。")
        assert spoke.status_code == 200, spoke.text
        assert spoke.json()["time_cost"] == 0
        assert spoke.json()["turn"] == 0
        seq = spoke.json()["seq"]
    assert seq == 1 + 3
    # 耗时动作（suction = 2）：时间前进 2
    acted = _turn(client, session_id, seq, request_id="a1", kind="action", affordance_id="suction")
    assert acted.status_code == 200, acted.text
    assert acted.json()["time_cost"] == 2
    assert acted.json()["turn"] == 2
    # 未建模：不花时间
    holder["llm"].intent = {"kind": "action", "affordance_id": None, "utterance": ""}
    unmodeled = _turn(client, session_id, acted.json()["seq"], request_id="u1", kind="action", text="我要给他插管。")
    assert unmodeled.json()["outcome"] == "unmodeled"
    assert unmodeled.json()["time_cost"] == 0
    assert unmodeled.json()["turn"] == 2


def test_blocked_costly_action_still_spends_time() -> None:
    """被世界阻止的**耗时**动作照样花时间（防"狂点被阻止"白刷）——确定性引擎用例。"""
    from modules.scenario_training.runtime.world import initial_world, settle_turn
    from modules.scenario_training.schema import ScenarioPack
    from modules.scenario_training.turns import AttemptOutcome, IntentKind, IntentResolution, TurnInput

    pack = ScenarioPack.model_validate(
        {
            "pack_schema_version": 3,
            "key": "cost-probe",
            "title": "耗时探针",
            "player": {"role": "护士"},
            "setting": {"place": "病房"},
            "actors": [{"id": "patient", "role": "患者"}],
            "state_keys": {"scene.done": False},
            "affordances": [
                {
                    "id": "long_shot",
                    "type": "act",
                    "label": "一次耗时处置",
                    "time_cost": 3,
                    "visible_when": {"all": [{"kind": "state_cmp", "key": "scene.done", "op": "==", "value": True}]},
                }
            ],
        }
    )
    world = initial_world(pack)
    resolved = settle_turn(
        pack,
        world,
        request=TurnInput(kind="action", affordance_id="long_shot"),
        intent=IntentResolution(kind=IntentKind.ACTION, affordance_id="long_shot"),
        request_id="probe",
        base_seq=0,
    )
    assert resolved.outcome is AttemptOutcome.BLOCKED
    assert resolved.block_reason == "affordance_unavailable"
    assert resolved.time_cost == 3
    assert resolved.turn == 3


def test_pure_exchange_never_farms_information(api) -> None:
    """防刷：同一时间单位内任意多次纯交流不得新增线索/读数/事实，也不触发时间阈值恶化。"""
    client, holder, db, _pack, revision = api
    session_id, seq = _open(client, holder, revision)
    from modules.scenario_training.runtime import session as session_mod

    before = session_mod.replay(db, session_id, _pack)
    snapshot = (list(before.revealed), dict(before.state), list(before.fired))
    for index in range(4):
        spoke = _turn(client, session_id, seq, request_id=f"x{index}", kind="speech", text="再跟我说说哪儿难受。")
        assert spoke.status_code == 200, spoke.text
        seq = spoke.json()["seq"]
    after = session_mod.replay(db, session_id, _pack)
    assert after.turn == 0
    assert list(after.revealed) == snapshot[0]
    assert dict(after.state) == snapshot[1]
    assert list(after.fired) == snapshot[2]


def test_identical_set_is_recorded_as_a_reading_not_a_change() -> None:
    """显式 `SET` 到同一数值 = **登记读数**（如"复测仍 88"），不是无效动作。

    不记的话，学生刚测完、拿到线索，设备面却还显示「未测量」（`measured`/`updated_turn` 都读
    `state_turns`）。同时：可见事件写成确认读数（「血氧：88」），不写假变化 `88 → 88`；
    而**增量**动作没推动数值时仍然按无效处理（"同一措施无效"）。
    """
    from modules.scenario_training.runtime.world import initial_world, settle_turn
    from modules.scenario_training.schema import ScenarioPack
    from modules.scenario_training.turns import AttemptOutcome, IntentKind, IntentResolution, TurnInput

    def _probe(effects: list[dict]) -> tuple:
        pack = ScenarioPack.model_validate(
            {
                "pack_schema_version": 3,
                "key": "reading-probe",
                "title": "读数探针",
                "player": {"role": "护士"},
                "setting": {"place": "病房"},
                "actors": [{"id": "patient", "role": "患者"}],
                "state_keys": {"scene.spo2": 88},
                "affordances": [
                    {"id": "read", "type": "measure", "label": "测血氧", "effects": effects, "time_cost": 0}
                ],
            }
        )
        world = initial_world(pack)
        resolved = settle_turn(
            pack,
            world,
            request=TurnInput(kind="action", affordance_id="read"),
            intent=IntentResolution(kind=IntentKind.ACTION, affordance_id="read"),
            request_id="probe",
            base_seq=0,
        )
        return world, resolved

    world, resolved = _probe([{"target": "scene", "key": "spo2", "op": "set", "value": 88}])
    assert resolved.outcome is AttemptOutcome.PERFORMED
    assert [(item.old, item.new) for item in resolved.effects] == [(88, 88)]
    assert world.state_turns["scene.spo2"] == [0, 0]  # 读数确实发生过（turn=0，time_cost=0）
    reading = [event.text for event in resolved.visible_events if event.kind == "effect"]
    assert reading == ["spo2：88"]  # 没有设备/白板标签时用键尾；关键是"确认读数"而不是变化
    assert "→" not in reading[0]

    # 增量没推动数值 → 仍然不算发生了变化（"同一措施无效"）
    world, resolved = _probe([{"target": "scene", "key": "spo2", "op": "incr", "value": 0}])
    assert resolved.effects == []
    assert world.state_turns["scene.spo2"] == [0]
