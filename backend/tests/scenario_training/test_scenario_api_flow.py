"""情境训练的 API 级回归：开关语义 + 一回合真实链路（假 LLM，不连外部服务）。

守的是"消费者可见的行为"：关掉开关整段 404；开着一回合能走通，
并且 DM 的违规内容（泄底按钮、未声明资源）会被拦下而不是送给学生。
"""

from __future__ import annotations

import json
from typing import Any

import pytest
from fastapi.testclient import TestClient

from core.database import get_db
from core.security import get_current_user
from modules.scenario_training import pack_loader
from modules.scenario_training import router as scenario_router

PACK_KEY = "sputum-ineffective"


class _FakeUser:
    id = 4242
    role_id = 1
    token_version = 1
    role = type("_Role", (), {"name": "student"})()
    # 与 models.User.has_permission 同形：学生侧判 `scenario_training`（2026-09-27 转正式特性）。
    permissions: set[str] = {"training_access", "scenario_training"}

    def has_permission(self, key: str) -> bool:
        return key in self.permissions


async def _no_rate_limit(*_args: Any, **_kwargs: Any) -> None:
    """限流在 API 链路里已单独覆盖（test_scenario_rate_limit）；这里不碰真限流表，
    避免跨用例共用同一个 user_id 把窗口打满。"""


class _FakeLLM:
    """按脚本返回 DM 回合；记录收到的 prompt 便于断言。"""

    def __init__(self, turn: dict[str, Any]) -> None:
        self.turn = turn
        self.calls: list[list[dict[str, str]]] = []

    async def call(self, messages: list[dict[str, str]], **_: Any) -> str:
        self.calls.append(messages)
        return json.dumps(self.turn, ensure_ascii=False)


def _dm_turn() -> dict[str, Any]:
    return {
        "narration": "你把探头重新扣好，数字没上来。",
        "lines": [{"actor": "patient", "text": "……憋……"}],
        "facts_declared": [{"fact": "吸氧下血氧仍低", "fact_id": "f_low_spo2", "evidence": "88%"}],
        "effects": [{"target": "scene.spo2", "key": "spo2", "op": "decr", "value": 2}],
        "reveals": ["c_low_spo2"],
        "images": [{"asset_id": "a_room", "caption": "病房"}],
        "options": [
            {"label": "听诊双肺", "type": "observe", "affordance_id": "auscultate"},
            {"label": "我自己想想", "type": "ask"},
            {"label": "问问他有没有痰栓堵塞", "type": "act", "affordance_id": "suction"},
            {"label": "其他（自己输入）", "type": "ask"},
        ],
    }


@pytest.fixture
def client(pg_session, monkeypatch):
    from main import app

    def _override_db():
        yield pg_session

    monkeypatch.setattr(scenario_router, "SCENARIO_TRAINING_ENABLED", True)
    monkeypatch.setattr(scenario_router, "check_scenario_open_limit", _no_rate_limit)
    monkeypatch.setattr(scenario_router, "check_scenario_action_limit", _no_rate_limit)
    pack_loader.reset_cache()
    overrides_before = dict(app.dependency_overrides)
    app.dependency_overrides[get_db] = _override_db
    app.dependency_overrides[get_current_user] = lambda: _FakeUser()
    original = getattr(app.state, "llm_client", None)
    app.state.llm_client = _FakeLLM(_dm_turn())
    app.state.scenario_image_provider = None
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.clear()
        app.dependency_overrides.update(overrides_before)  # 不破坏其他测试的覆盖
        app.state.llm_client = original
        pack_loader.reset_cache()


@pytest.fixture
def installed_pack(pg_session):
    pack = pack_loader.load_pack_file(PACK_KEY)
    _, revision, _ = pack_loader.install(pg_session, pack)
    return pack, revision


def test_disabled_feature_is_invisible(client, pg_session, monkeypatch) -> None:
    monkeypatch.setattr(scenario_router, "SCENARIO_TRAINING_ENABLED", False)
    assert client.get("/api/scenario/packs").status_code == 404


def test_student_side_requires_scenario_training_permission(client, pg_session) -> None:
    """学生侧不再"登录即可"（2026-09-27 转正式特性）：缺 `scenario_training` → 403。

    开关是另一层：`require_enabled` 关掉时整段 404（见上一条），两者互不替代。
    """
    from main import app

    class _NoScenario(_FakeUser):
        permissions: set[str] = {"training_access", "qa_access"}

    app.dependency_overrides[get_current_user] = lambda: _NoScenario()
    assert client.get("/api/scenario/packs").status_code == 403
    assert client.post("/api/scenario/sessions", json={"pack_key": PACK_KEY}).status_code == 403

    # 有该键（夹具默认用户）→ 正常放行
    app.dependency_overrides[get_current_user] = lambda: _FakeUser()
    assert client.get("/api/scenario/packs").status_code == 200


def test_full_turn_pipeline(client, pg_session, installed_pack) -> None:
    pack, revision = installed_pack
    opened = client.post("/api/scenario/sessions", json={"pack_key": PACK_KEY})
    assert opened.status_code == 200, opened.text
    body = opened.json()
    session_id = body["session_id"]
    view = body["view"]
    assert view["pack"]["revision_id"] == revision.id
    assert [asset["id"] for asset in view["assets"]] == ["a_room"]
    assert view["pack"]["player_role"] == pack.player.role

    # 开场：DM 先立场景（学生还没做任何事）
    assert view["session"]["turn"] == 0
    assert view["messages"], "开场必须有 DM 的叙述/台词"
    assert view["messages"][0]["role"] == "scene"
    assert "你把探头重新扣好" in view["messages"][0]["text"]

    acted = client.post(
        f"/api/scenario/sessions/{session_id}/actions",
        json={"affordance_id": "measure_spo2"},
    )
    assert acted.status_code == 200, acted.text
    after = acted.json()
    view = after["view"]

    # DM 的违规选项被拦下：泄底条目与自带"其他"都不进视图
    labels = [option["label"] for option in view["options"]]
    assert "听诊双肺" in labels
    assert "我自己想想" in labels
    assert all("痰栓" not in label for label in labels)
    assert all("其他" not in label for label in labels)
    assert any(problem.startswith("leaked_fact_term") for problem in after["problems"])
    assert "dm_supplied_free_input" in after["problems"]

    # 图片按资源包投影成可加载 URL；状态改动落在已登记键上
    assert view["images"][0]["asset_id"] == "a_room"
    assert view["images"][0]["url"] == f"/api/scenario/assets/{revision.id}/a_room"
    # 状态改动落在已登记键上：开场与首回合各扣 2（假 DM 的固定效果）；读数经**设备面**投影
    channel = view["devices"][0]["channels"][0]
    assert channel["ref"] == "scene.spo2"
    assert channel["value"] == pack.state_keys["scene.spo2"] - 4
    assert view["session"]["turn"] == 1

    # 资源可被鉴权加载，且只服务本包声明过的资源
    asset = client.get(f"/api/scenario/assets/{revision.id}/a_room")
    assert asset.status_code == 200
    assert asset.headers["content-type"].startswith("image/webp")  # 上传/播种都归一为 WebP
    assert client.get(f"/api/scenario/assets/{revision.id}/nope").status_code == 404

    closed = client.post(f"/api/scenario/sessions/{session_id}/close")
    assert closed.status_code == 200, closed.text
    report = closed.json()["report"]
    assert report["turn"] == 1
    assert set(report["summary"]) == {"strong", "adequate", "missed"}
    assert report["dims"], "经历量化投影必须有值"
    # 结算给**得分率**与逐条权重/得分（每场景自写 rubric）
    assert report["score"]["rate"] is not None
    assert report["score"]["total_weight"] > 0
    assert report["criteria"]
    assert all("weight" in row and "score" in row for row in report["criteria"])


def test_stream_endpoint_emits_blocks_before_view(client, pg_session, installed_pack) -> None:
    """增量渲染：叙述块**先**到，权威视图**后**到；状态等完整回合校验后才落地。"""
    from main import app

    _pack, _revision = installed_pack

    class _StreamingLLM(_FakeLLM):
        async def stream(self, messages, **kwargs):  # type: ignore[override]
            text = json.dumps(self.turn, ensure_ascii=False)
            for index in range(0, len(text), 24):
                yield text[index : index + 24]

    app.state.llm_client = _StreamingLLM(_dm_turn())

    opened = client.post("/api/scenario/sessions", json={"pack_key": PACK_KEY})
    assert opened.status_code == 200, opened.text
    session_id = opened.json()["session_id"]

    events: list[dict] = []
    with client.stream(
        "POST", f"/api/scenario/sessions/{session_id}/actions/stream", json={"affordance_id": "measure_spo2"}
    ) as response:
        assert response.status_code == 200
        assert response.headers["content-type"].startswith("text/event-stream")
        assert response.headers["x-accel-buffering"] == "no"  # 生产 nginx 下必须不缓冲
        for line in response.iter_lines():
            if line.startswith("data: "):
                events.append(json.loads(line[6:]))

    kinds = [event["kind"] for event in events]
    assert "blocks" in kinds, events
    assert kinds[-1] == "view"
    assert kinds.index("blocks") < kinds.index("view")

    narration_blocks = [event["blocks"].get("narration") for event in events if event["kind"] == "blocks"]
    assert any(text and "你把探头重新扣好" in text for text in narration_blocks)

    view = events[-1]["view"]
    assert view["session"]["turn"] == 1  # 开场算第 0 回合；这一次动作是第 1 回合
    assert any(message["role"] == "actor" for message in view["messages"])


def test_session_is_owner_scoped(client, pg_session, installed_pack) -> None:
    opened = client.post("/api/scenario/sessions", json={"pack_key": PACK_KEY})
    session_id = opened.json()["session_id"]
    assert client.get(f"/api/scenario/sessions/{session_id}").status_code == 200

    class _OtherUser(_FakeUser):
        id = 9999

    from main import app

    app.dependency_overrides[get_current_user] = lambda: _OtherUser()
    assert client.get(f"/api/scenario/sessions/{session_id}").status_code == 404


# ── 动作归属回填：学生**自由表达** → DM 认到已声明的 affordance ──────────────
#
# 交互模型改成自由表达为主之后，动作记录不再天然带 `affordance_id`：DM 的
# `interpretation.affordance_id` 由引擎回填（越权映射在校验层被丢弃）。
# 这一组用例守的是**消费方可见**的后果：白板「已处置」、时间线、维度、判读、事件流。


def test_messages_are_in_turn_order_not_grouped_by_kind(client, pg_session, installed_pack) -> None:
    """对话流**按时序**：每回合 学生 → 旁白 → 台词，而不是"先全部旁白、再全部台词"。

    2026-09-28 的缺陷：`build_view` 先遍历 `world.narrations` 再遍历 `world.lines`，
    于是学生看到的是按类型归类的两段（旁白一堆、台词一堆），与真实对话的因果顺序不符。
    学生自己的动作也是在这一次修正里进对话流的（他先做，世界才回应）。
    """
    turns = [
        {"narration": "旁白一", "lines": [{"actor": "patient", "text": "台词一"}]},
        {"narration": "旁白二", "lines": [{"actor": "patient", "text": "台词二"}]},
        {"narration": "旁白三", "lines": [{"actor": "patient", "text": "台词三"}]},
    ]
    session_id = _open(client, turns)
    _act(client, session_id, type="ask", text="我看看他")
    view = _act(client, session_id, type="ask", text="我再看看他")["view"]

    texts = [(message["role"], message["text"]) for message in view["messages"]]
    # 剧本顺序：开场（学生还没做任何事）→ 第 1 回合学生动作 + 世界回应 → 第 2 回合同理
    assert texts == [
        ("scene", "旁白一"),
        ("actor", "台词一"),
        ("student", "我看看他"),
        ("scene", "旁白二"),
        ("actor", "台词二"),
        ("student", "我再看看他"),
        ("scene", "旁白三"),
        ("actor", "台词三"),
    ], texts
    # 回合号单调不减（跨回合顺序不倒退）
    turns_in_view = [message.get("turn") for message in view["messages"]]
    assert turns_in_view == sorted(turns_in_view), turns_in_view


def test_student_actions_are_messages_of_their_own(client, pg_session, installed_pack) -> None:
    """学生做过的事也在对话流里（`role: student`）：自由表达用原话，点按钮用 affordance 标签。

    2026-09-28 用户报告：「自己的操作和发言缺乏气泡」——只有世界在动，看起来像自说自话。
    """
    session_id = _open(client, [_clean_turn(), _clean_turn(), _clean_turn()])
    _act(client, session_id, type="ask", text="你哪里不舒服？")
    view = _act(client, session_id, affordance_id="measure_spo2")["view"]

    rows = [(message["role"], message["text"], message.get("turn")) for message in view["messages"]]
    students = [row for row in rows if row[0] == "student"]
    assert [row[1] for row in students] == ["你哪里不舒服？", "测血氧"], rows
    # 他先做，世界才回应：本回合的学生那条排在本回合的旁白之前
    last_student = max(index for index, row in enumerate(rows) if row[0] == "student")
    same_turn_scene = [index for index, row in enumerate(rows) if row[0] == "scene" and row[2] == rows[last_student][2]]
    assert same_turn_scene, rows
    assert last_student < min(same_turn_scene), rows


def _clean_turn(**extra: Any) -> dict[str, Any]:
    """一个**不违规**的 DM 回合（本组只关心归属，不想被泄底/自输入的 problem 干扰）。"""
    return {"narration": "监护仪的数字没动。", "lines": [{"actor": "patient", "text": "……"}], **extra}


class _ScriptedLLM:
    """按顺序回放预置回合（开场一次、每次动作一次）；用尽后回空对象（= 无内容回合）。"""

    def __init__(self, turns: list[dict[str, Any]]) -> None:
        self.turns = list(turns)

    async def call(self, messages: list[dict[str, str]], **_: Any) -> str:
        return json.dumps(self.turns.pop(0) if self.turns else {}, ensure_ascii=False)


def _board_done(view: dict[str, Any]) -> list[str]:
    """白板「已处置」版块的条目文案。"""
    section = next(item for item in view["board"]["sections"] if item["source"] == "action")
    return [entry["text"] for entry in section["entries"]]


def _student_timeline(view: dict[str, Any]) -> list[str]:
    return [item["label"] for item in view["timeline"] if item["kind"] == "student"]


def _attributions(pg_session: Any, session_id: int) -> list[dict[str, Any]]:
    """事件流里的回填记录（按 seq 排；回填是状态写入，必须留痕）。"""
    from sqlalchemy import select

    from models.scenario_training import StEvent

    rows = pg_session.execute(select(StEvent).where(StEvent.session_id == session_id).order_by(StEvent.seq)).scalars()
    return [row.payload for row in rows if row.kind == "action_attributed"]


def _open(client, turns: list[dict[str, Any]]) -> int:
    from main import app

    app.state.llm_client = _ScriptedLLM(turns)
    opened = client.post("/api/scenario/sessions", json={"pack_key": PACK_KEY})
    assert opened.status_code == 200, opened.text
    return opened.json()["session_id"]


def _act(client, session_id: int, **payload: Any) -> dict[str, Any]:
    acted = client.post(f"/api/scenario/sessions/{session_id}/actions", json=payload)
    assert acted.status_code == 200, acted.text
    return acted.json()


def test_free_expression_is_attributed_to_declared_action(client, pg_session, installed_pack) -> None:
    """DM 认下的动作要像"真的做过"一样出现在白板/时间线/维度/判读里。"""
    session_id = _open(
        client,
        [
            _clean_turn(),  # 开场
            _clean_turn(interpretation={"affordance_id": "suction"}),
            _clean_turn(interpretation={"affordance_id": "bag_valve"}),
        ],
    )

    first = _act(client, session_id, type="act", text="给他吸痰，只吸出一点血丝")
    assert first["problems"] == []
    view = first["view"]
    assert _board_done(view) == ["吸痰"]  # 白板「已处置」不再漏记
    assert _student_timeline(view) == ["吸痰"]  # 时间线按声明动作显示

    second = _act(client, session_id, type="act", text="上球囊面罩加压给氧")
    view = second["view"]
    assert _board_done(view) == ["吸痰", "球囊面罩加压给氧"]
    escalation = next(item for item in view["dims"] if item["id"] == "d_escalation")
    assert escalation["value"] == 2, escalation  # 「升级延迟」维度的目标动作集合不再"从未出现"
    assert "首用于第2回合" in escalation["detail"]

    # 回填留痕：一条事件一条归属，标明来源（回放/统计靠它）
    assert _attributions(pg_session, session_id) == [
        {"turn": 1, "affordance_id": "suction", "source": "dm"},
        {"turn": 2, "affordance_id": "bag_valve", "source": "dm"},
    ]

    report = client.post(f"/api/scenario/sessions/{session_id}/close").json()["report"]
    repeat = next(row for row in report["criteria"] if row["id"] == "dp_no_repeat")
    assert repeat["anchor"] == "strong", repeat  # 判读的目标动作集合命中了自由表达的「吸痰」
    assert "「吸痰」累计使用 1 次" in repeat["detail"]
    escalate = next(row for row in report["criteria"] if row["id"] == "dp_escalate")
    assert escalate["anchor"] == "adequate"
    assert "命中 1/2" in escalate["detail"]


def test_interpretation_to_locked_or_undeclared_action_is_ignored(client, pg_session, installed_pack) -> None:
    """越权映射被忽略：留一条 problem，记录里不带 id（宁缺毋假）。"""
    session_id = _open(
        client,
        [
            _clean_turn(),  # 开场
            # 医生到场 → 此后「呼叫值班医生」这扇门已关（visible_when: doctor_present == false）
            _clean_turn(effects=[{"target": "scene", "key": "doctor_present", "op": "set", "value": True}]),
            _clean_turn(interpretation={"affordance_id": "call_doctor"}),
            _clean_turn(interpretation={"affordance_id": "cure_everything"}),
        ],
    )
    _act(client, session_id, affordance_id="auscultate")

    locked = _act(client, session_id, type="summon", text="喊医生过来")
    assert "locked_affordance:call_doctor" in locked["problems"]
    assert _board_done(locked["view"]) == ["听诊双肺"], "未解锁的动作不得被认领"

    unknown = _act(client, session_id, type="act", text="胡乱处理一下")
    assert "unknown_affordance:cure_everything" in unknown["problems"]
    assert _board_done(unknown["view"]) == ["听诊双肺"]

    assert _attributions(pg_session, session_id) == []  # 越权映射不落痕


def test_unmapped_free_expression_stays_unattributed(client, pg_session, installed_pack) -> None:
    """DM 没给出映射 → 留空：不算任何声明动作（不进白板、不改时间线标签、不落痕）。"""
    session_id = _open(client, [_clean_turn(), _clean_turn()])

    body = _act(client, session_id, type="ask", text="他以前有什么病史？")
    assert body["problems"] == []
    assert _board_done(body["view"]) == []
    assert _student_timeline(body["view"]) == ["他以前有什么病史？"]  # 自由文本原样呈现
    assert _attributions(pg_session, session_id) == []


def test_student_choice_is_not_overridden_by_interpretation(client, pg_session, installed_pack) -> None:
    """学生自己点了按钮 → 以他点的为准，DM 的 interpretation 不得覆盖。"""
    session_id = _open(client, [_clean_turn(), _clean_turn(interpretation={"affordance_id": "suction"})])

    body = _act(client, session_id, affordance_id="measure_spo2")
    assert body["problems"] == []
    assert _board_done(body["view"]) == ["测血氧"]
    assert _attributions(pg_session, session_id) == []

    report = client.post(f"/api/scenario/sessions/{session_id}/close").json()["report"]
    repeat = next(row for row in report["criteria"] if row["id"] == "dp_no_repeat")
    assert repeat["anchor"] == "adequate"
    assert "从未使用" in repeat["detail"]


def test_streamed_turn_attributes_free_expression(client, pg_session, installed_pack) -> None:
    """流式路径与落地路径走**同一套**归属逻辑（学生控制台提交的就是这条）。"""
    from main import app

    class _StreamingLLM(_ScriptedLLM):
        async def stream(self, messages: list[dict[str, str]], **_: Any):  # type: ignore[override]
            text = json.dumps(self.turns.pop(0) if self.turns else {}, ensure_ascii=False)
            for index in range(0, len(text), 24):
                yield text[index : index + 24]

    app.state.llm_client = _StreamingLLM([_clean_turn(), _clean_turn(interpretation={"affordance_id": "suction"})])
    opened = client.post("/api/scenario/sessions", json={"pack_key": PACK_KEY})
    session_id = opened.json()["session_id"]

    events: list[dict[str, Any]] = []
    with client.stream(
        "POST", f"/api/scenario/sessions/{session_id}/actions/stream", json={"type": "act", "text": "给他吸痰"}
    ) as response:
        assert response.status_code == 200
        for line in response.iter_lines():
            if line.startswith("data: "):
                events.append(json.loads(line[6:]))

    assert events[-1]["kind"] == "view"
    assert _board_done(events[-1]["view"]) == ["吸痰"]
    assert _attributions(pg_session, session_id) == [{"turn": 1, "affordance_id": "suction", "source": "dm"}]


# ── DM 的受限多步循环：先读环境，再产出信封（docs/21 §四） ──────────────────


def _steps(pg_session: Any, session_id: int) -> list[dict[str, Any]]:
    """事件流里的多步循环记录（按 seq 排）。"""
    from sqlalchemy import select

    from models.scenario_training import StEvent

    rows = pg_session.execute(select(StEvent).where(StEvent.session_id == session_id).order_by(StEvent.seq)).scalars()
    return [row.payload for row in rows if row.kind == "dm_step"]


def test_multi_step_loop_records_each_step_as_an_event(client, pg_session, installed_pack) -> None:
    """DM 先读环境（`world.state`）再产出信封：读到的结果进对话，每一步都落 `dm_step`。"""
    _pack, _revision = installed_pack
    session_id = _open(
        client,
        [
            _clean_turn(),  # 开场：直接给信封
            {"tool": "world.state", "args": {}},  # 本回合第 1 步：读环境
            _clean_turn(interpretation={"affordance_id": "suction"}),  # 读完再产出信封
        ],
    )
    body = _act(client, session_id, type="act", text="给他吸痰")
    assert body["problems"] == []
    assert _board_done(body["view"]) == ["吸痰"]

    steps = _steps(pg_session, session_id)
    assert len(steps) == 1
    assert {key: value for key, value in steps[0].items() if key != "ms"} == {
        "turn": 1,
        "step": 1,
        "tool": "world.state",
        "args": {},
        "ok": True,
        "result": "turn=1 state=6 项",
    }
    # 学生侧只看到叙事，看不到 DM 的读取动作（`dm_step` 是给教师回放与统计用的）
    assert "world.state" not in json.dumps(body["view"], ensure_ascii=False)


# ── 归属之后补求值一次反应边沿：自由表达与按钮对世界是同一件事 ──────────────

_R_SUCTION_INTENT = "吸出少量血性黏痰后症状毫无缓解"


def _effects(pg_session: Any, session_id: int) -> list[dict[str, Any]]:
    """事件流里的状态改动（可回放、可解释：每条带来源）。"""
    from sqlalchemy import select

    from models.scenario_training import StEvent

    rows = pg_session.execute(select(StEvent).where(StEvent.session_id == session_id).order_by(StEvent.seq)).scalars()
    return [item for row in rows if row.kind == "effects_applied" for item in row.payload["items"]]


def _world_beats(view: dict[str, Any], intent: str) -> int:
    return sum(1 for item in view["timeline"] if item["kind"] == "world" and intent in item["label"])


def test_free_expression_fires_reactions_like_the_button_path(client, pg_session, installed_pack) -> None:
    """归属回填后**再求值一次边沿**：自由表达的「吸痰」像点按钮一样触发 pack 反应，且只触发一次。

    同时守住两个方向：本回合被归属的动作（`action_count_gte(suction)`）要补发；
    本回合已发过的反应（回合数型）不许因为第二次求值而重复发售。
    """
    pack, _revision = installed_pack
    comfort = pack.state_keys["patient.comfort"]

    session_id = _open(
        client,
        [
            _clean_turn(),  # 开场
            _clean_turn(),  # 第 1 回合：自由表达（DM 没给归属）
            _clean_turn(),  # 第 2 回合
            _clean_turn(interpretation={"affordance_id": "suction"}),  # 第 3 回合：认到「吸痰」
        ],
    )
    _act(client, session_id, type="ask", text="先看一眼")
    _act(client, session_id, type="ask", text="再等一下")
    third = _act(client, session_id, type="act", text="给他吸痰")  # 第 3 回合起 r_deteriorate 也会成立

    view = third["view"]
    assert _board_done(view) == ["吸痰"]  # 归属确实发生了（否则这段补求值不会跑）
    assert _world_beats(view, _R_SUCTION_INTENT) == 1  # 被认领的动作让反应**本回合**成立
    rows = _effects(pg_session, session_id)
    assert [row["new"] for row in rows if row["key"] == "patient.comfort"] == [comfort - 1]
    # 回合数型反应（r_deteriorate，两条效果）本就该在这一回合发一次——
    # 第二次求值不得让它重复发售：两条效果各只出现一次，就是"只发了一次"的凭据
    assert [row["new"] for row in rows if row["key"] == "scene.spo2"] == [pack.state_keys["scene.spo2"] - 2]
    assert [row["new"] for row in rows if row["key"] == "patient.consciousness"] == [
        pack.state_keys["patient.consciousness"] - 1
    ]
    sources = [row["source"] for row in rows if row["source"].startswith("reaction:")]
    assert sources.count("reaction:r_deteriorate") == 2  # 该反应的两条效果……
    assert sources.count("reaction:r_suction_first") == 1  # ……被认领的动作补发的那一条

    # 下一回合：边沿已过，不再重复触发
    fourth = _act(client, session_id, type="ask", text="还有别的办法吗")
    assert _world_beats(fourth["view"], _R_SUCTION_INTENT) == 1
    assert _effects(pg_session, session_id) == rows

    # 对照按钮路径：同一反应、同一后果
    button_id = _open(client, [_clean_turn(), _clean_turn(), _clean_turn()])
    button = _act(client, button_id, affordance_id="suction")
    assert _world_beats(button["view"], _R_SUCTION_INTENT) == 1
    button_rows = [row for row in _effects(pg_session, button_id) if row["key"] == "patient.comfort"]
    assert [(row["source"], row["new"]) for row in button_rows] == [("reaction:r_suction_first", comfort - 1)]


def test_streamed_multi_step_turn_commits_steps_and_state_together(client, pg_session, installed_pack) -> None:
    """流式 + 多步：`dm_step` 在状态落库**之前**就写进了同一个事务，随回合一起提交（要么都有、要么都没有）。"""
    from main import app

    class _StreamingLLM(_ScriptedLLM):
        async def stream(self, messages: list[dict[str, str]], **_: Any):  # type: ignore[override]
            text = json.dumps(self.turns.pop(0) if self.turns else {}, ensure_ascii=False)
            for index in range(0, len(text), 16):
                yield text[index : index + 16]

    app.state.llm_client = _StreamingLLM(
        [
            _clean_turn(),  # 开场
            {"tool": "world.state", "args": {}},  # 第 1 步：读环境
            _clean_turn(interpretation={"affordance_id": "suction"}),  # 信封
        ]
    )
    opened = client.post("/api/scenario/sessions", json={"pack_key": PACK_KEY})
    session_id = opened.json()["session_id"]

    events: list[dict[str, Any]] = []
    with client.stream(
        "POST", f"/api/scenario/sessions/{session_id}/actions/stream", json={"type": "act", "text": "给他吸痰"}
    ) as response:
        assert response.status_code == 200
        for line in response.iter_lines():
            if line.startswith("data: "):
                events.append(json.loads(line[6:]))

    assert events[-1]["kind"] == "view"
    assert _board_done(events[-1]["view"]) == ["吸痰"]
    assert [row["tool"] for row in _steps(pg_session, session_id)] == ["world.state"]
    assert _attributions(pg_session, session_id) == [{"turn": 1, "affordance_id": "suction", "source": "dm"}]
