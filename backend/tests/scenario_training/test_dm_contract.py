"""DM 契约与场景资源的单元测试（纯逻辑：不连库、不调 LLM）。"""

from __future__ import annotations

import pytest

from modules.scenario_training.assets import ASSETS_ROOT
from modules.scenario_training.dm.contract import (
    DMOption,
    DMTurn,
    validate_turn,
)
from modules.scenario_training.runtime.world import World, initial_world, reveal_cues
from modules.scenario_training.schema import AffordanceType, Effect, EffectOp, ScenarioPack
from modules.scenario_training.validation import validate_pack


@pytest.fixture(scope="module")
def pack() -> ScenarioPack:
    from modules.scenario_training.pack_loader import load_pack_file

    return load_pack_file("sputum-ineffective")


def test_pack_passes_load_validation(pack: ScenarioPack) -> None:
    assert validate_pack(pack) == []


def test_effect_key_shapes_are_tolerated(pack: ScenarioPack) -> None:
    """DM 把键写进 target 或分开写，都要落到同一个已登记状态键。"""
    turn = DMTurn.model_validate(
        {
            "effects": [
                {"target": "scene", "key": "spo2", "op": "incr", "value": 2},
                {"target": "scene.spo2", "key": "spo2", "op": "decr", "value": 1},
                {"target": "scene", "key": "not_declared", "op": "set", "value": 1},
            ]
        }
    )
    check = validate_turn(pack, turn)
    assert [(effect.target, effect.key) for effect in check.turn.effects] == [
        ("scene", "spo2"),
        ("scene", "spo2"),
    ]
    assert check.dropped.get("effects") == 1
    assert any(problem.startswith("undeclared_state_key") for problem in check.problems)


def test_effect_op_aliases_are_normalized(pack: ScenarioPack) -> None:
    """DM 常写 add/sub/delta；归一后不该再白花一次重试。"""
    check = validate_turn(
        pack,
        DMTurn.model_validate(
            {
                "effects": [
                    {"target": "scene", "key": "spo2", "op": "add", "value": 1},
                    {"target": "patient", "key": "comfort", "op": "-=", "value": 1},
                    {"target": "scene", "key": "spo2", "op": "delta", "value": -2},
                    {"target": "scene", "key": "spo2", "op": "delta", "value": 3},
                ]
            }
        ),
    )
    ops = [effect.op for effect in check.turn.effects]
    assert ops == [EffectOp.INCR, EffectOp.DECR, EffectOp.DECR, EffectOp.INCR]
    assert check.problems == []


def test_undeclared_effect_never_reaches_the_world(pack: ScenarioPack) -> None:
    """未登记键即使混在合法键里，也不会被应用（世界状态由声明保证可知）。"""
    world = initial_world(pack)
    before = dict(world.state)
    check = validate_turn(
        pack,
        DMTurn.model_validate({"effects": [{"target": "scene", "key": "ghost", "op": "set", "value": 1}]}),
    )
    assert check.turn.effects == []
    assert world.state == before


def test_images_only_from_pack_assets(pack: ScenarioPack) -> None:
    check = validate_turn(
        pack,
        DMTurn.model_validate(
            {
                "images": [
                    {"asset_id": "a_room", "caption": "病房"},
                    {"asset_id": "not_declared", "caption": "x"},
                ]
            }
        ),
    )
    assert [image.asset_id for image in check.turn.images] == ["a_room"]
    assert check.problems == ["unknown_asset:not_declared"]


def test_image_request_requires_explicit_opt_in(pack: ScenarioPack) -> None:
    turn = {"image_request": {"prompt": "a dim ward at night", "caption": "环境"}}
    assert pack.image_generation == "disabled"
    check = validate_turn(pack, DMTurn.model_validate(turn))
    assert check.turn.image_request is None
    assert check.problems == ["image_generation_disabled"]

    allowed = pack.model_copy(update={"image_generation": "allowed"})
    ok = validate_turn(allowed, DMTurn.model_validate(turn))
    assert ok.turn.image_request is not None


def test_seed_source_file_exists_for_declared_assets(pack: ScenarioPack) -> None:
    """pack 声明的 `path` 指向的播种文件确实在仓库里（运行时不读文件，安装时读）。"""
    for asset in pack.assets:
        if asset.path:
            assert (ASSETS_ROOT / pack.key / asset.path).is_file(), f"缺播种文件：{asset.id}"


def test_leak_guard_uses_dm_supplied_free_input(pack: ScenarioPack) -> None:
    check = validate_turn(
        pack,
        DMTurn.model_validate({"options": [{"label": "其他（自己输入）", "type": "ask"}]}),
    )
    assert check.turn.options == []
    assert check.problems == ["dm_supplied_free_input"]


def test_leak_guard_exempts_already_revealed_facts(pack: ScenarioPack) -> None:
    """学生已经看到的线索，DM 可以在按钮里谈论它；没看到的则不行。"""
    label = "听诊确认两侧呼吸音消失是否改善"
    option = DMOption(label=label, type=AffordanceType.OBSERVE, affordance_id="auscultate")

    fresh = initial_world(pack)
    blocked = validate_turn(pack, DMTurn(options=[option]), fresh)
    assert blocked.turn.options == []
    assert any(problem.startswith("leaked_fact_term") for problem in blocked.problems)

    revealed = initial_world(pack)
    reveal_cues(pack, revealed, ["c_left_absent"])
    allowed = validate_turn(pack, DMTurn(options=[option]), revealed)
    assert [item.label for item in allowed.turn.options] == [label]


def test_world_state_effects_are_noops_when_unchanged(pack: ScenarioPack) -> None:
    """同值写入不算"世界的改变"（无效动作的记账基础）。"""
    from modules.scenario_training.runtime.world import apply_effects

    world = initial_world(pack)
    applied = apply_effects(
        pack,
        world,
        [Effect(target="patient", key="comfort", op=EffectOp.SET, value=world.state["patient.comfort"])],
        source="test",
    )
    assert applied == []


def test_ephemeral_speaker_needs_a_visible_role(pack: ScenarioPack) -> None:
    """DM 可以临时拉一个人开口（带显示名），但不能用无名 key 冒充在场者。"""
    lines = [
        {"actor": "patient", "text": "……"},
        {"actor": "porter", "as_role": "走廊里的护工", "text": "哎，让让——"},
        {"actor": "ghost", "text": "无名无姓"},
    ]
    check = validate_turn(pack, DMTurn.model_validate({"lines": lines}))
    kept = [(line.actor, line.ephemeral, line.as_role) for line in check.turn.lines]
    assert kept == [("patient", False, ""), ("porter", True, "走廊里的护工")]
    assert check.problems == ["unknown_actor:ghost"]


def test_ephemeral_speaker_reaches_view_with_avatar_seed(pack: ScenarioPack) -> None:
    from modules.scenario_training.runtime.view import build_view

    world = initial_world(pack)
    world.lines.append(
        {"actor": "porter", "as_role": "走廊里的护工", "text": "哎，让让——", "ephemeral": True, "origin": "dm"}
    )
    view = build_view(pack, world, session_id=1, status="active", revision_id=9)
    line = view["messages"][0]
    assert line["actor_role"] == "走廊里的护工"
    assert line["ephemeral"] is True
    assert line["avatar_seed"] == "走廊里的护工"


def test_provider_http_error_falls_back_instead_of_500(pack: ScenarioPack) -> None:
    """供应商返回 HTTP 错误时必须落到保底回合（实测修正 2026-09-27）。"""
    import asyncio

    import httpx

    from modules.scenario_training.dm.runner import run_dm
    from modules.scenario_training.runtime.world import ActionRecord

    class Boom:
        async def call(self, messages: list[dict[str, str]], **_: object) -> str:
            request = httpx.Request("POST", "https://example.invalid")
            raise httpx.HTTPStatusError("boom", request=request, response=httpx.Response(500, request=request))

    world = initial_world(pack)
    action = ActionRecord(turn=1, affordance_id="measure_spo2", type="measure")
    turn, problems = asyncio.run(run_dm(Boom(), pack, world, action, [], user_id=1))  # type: ignore[arg-type]

    assert any(problem.startswith("dm_provider_error:") for problem in problems)
    assert "dm_fallback" in problems
    assert turn.options, "保底回合仍要给出可用动作"


def test_dm_line_origin_defaults_to_dm(pack: ScenarioPack) -> None:
    check = validate_turn(pack, DMTurn.model_validate({"lines": [{"actor": "patient", "text": "……"}]}))
    assert check.turn.lines[0].origin == "dm"


def test_delegate_requires_dedicated_actor(pack: ScenarioPack) -> None:
    """预留能力边界：把台词委托给 inline 角色是不允许的。"""
    check = validate_turn(pack, DMTurn.model_validate({"delegate": [{"actor": "patient", "intent": "说一句"}]}))
    assert check.turn.delegate == []
    assert check.problems == ["delegate_to_inline_actor:patient"]

    dedicated = pack.model_copy(
        update={"actors": [pack.actors[0].model_copy(update={"entity": "dedicated"}), pack.actors[1]]}
    )
    ok = validate_turn(dedicated, DMTurn.model_validate({"delegate": [{"actor": "patient", "intent": "说一句"}]}))
    assert len(ok.turn.delegate) == 1


def test_images_in_view_use_fake_world(pack: ScenarioPack) -> None:
    """世界里的图片经视图投影后带上可用的 URL（前端据此用鉴权组件加载）。"""
    from modules.scenario_training.runtime.view import build_view

    world: World = initial_world(pack)
    world.images.append({"asset_id": "a_room", "caption": "病房", "origin": "pack"})
    view = build_view(pack, world, session_id=7, status="active", revision_id=3)
    assert view["pack"]["revision_id"] == 3
    assert view["images"][0]["url"] == "/api/scenario/assets/3/a_room"
    assert [asset["id"] for asset in view["assets"]] == ["a_room"]


def test_interpretation_keeps_declared_and_unlocked_action(pack: ScenarioPack) -> None:
    """学生自由表达时，DM 把这句话映射到某个**已声明且已解锁**的动作 → 原样保留（供引擎回填）。"""
    check = validate_turn(
        pack,
        DMTurn.model_validate({"interpretation": {"affordance_id": "suction"}}),
        initial_world(pack),
    )
    assert check.turn.interpretation is not None
    assert check.turn.interpretation.affordance_id == "suction"
    assert check.problems == []


def test_interpretation_to_locked_action_is_dropped(pack: ScenarioPack) -> None:
    """门还没开的动作不能被认领（越权 → 丢弃 + 记账）；认错比漏认更坏。"""
    world = initial_world(pack)
    world.state["scene.doctor_present"] = True  # 医生已在场 →「呼叫值班医生」这扇门已关
    check = validate_turn(pack, DMTurn.model_validate({"interpretation": {"affordance_id": "call_doctor"}}), world)
    assert check.turn.interpretation is None
    assert check.problems == ["locked_affordance:call_doctor"]
    assert check.dropped.get("interpretation") == 1


def test_interpretation_to_undeclared_action_is_dropped(pack: ScenarioPack) -> None:
    check = validate_turn(pack, DMTurn.model_validate({"interpretation": {"affordance_id": "cure_everything"}}))
    assert check.turn.interpretation is None
    assert check.problems == ["unknown_affordance:cure_everything"]
    assert check.dropped.get("interpretation") == 1


def test_interpretation_absent_or_blank_stays_empty(pack: ScenarioPack) -> None:
    """映射不出就留空：缺省、null、空对象、空白串都**不编造**归属。"""
    for payload in ({}, {"interpretation": None}, {"interpretation": {}}, {"interpretation": {"affordance_id": "  "}}):
        check = validate_turn(pack, DMTurn.model_validate(payload))
        assert check.turn.interpretation is None
        assert check.problems == []


def test_action_attribution_replays_onto_the_right_record(pack: ScenarioPack) -> None:
    """回填走事件流：回放时把 id 补到**对应回合**的记录上；学生自己选的按钮不被覆盖。"""
    from modules.scenario_training.runtime.world import world_from_events

    events = [
        {
            "kind": "student_action",
            "payload": {"turn": 1, "action": {"turn": 1, "affordance_id": None, "type": "act", "text": "给他吸痰"}},
        },
        {"kind": "action_attributed", "payload": {"turn": 1, "affordance_id": "suction", "source": "dm"}},
        {
            "kind": "student_action",
            "payload": {
                "turn": 2,
                "action": {"turn": 2, "affordance_id": "measure_spo2", "type": "measure", "text": None},
            },
        },
        {"kind": "action_attributed", "payload": {"turn": 2, "affordance_id": "suction", "source": "dm"}},
    ]
    world = world_from_events(pack, events)
    assert [action.affordance_id for action in world.actions] == ["suction", "measure_spo2"]
    assert [action.label(pack) for action in world.actions] == ["吸痰", "测血氧"]
    assert len(world.used("suction")) == 1
