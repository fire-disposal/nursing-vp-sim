"""工具集 v1：**模型在环境里做事的唯一通道**（docs/scenario.md）。

每次调用都在平台侧**逐条校验**，通过才落到暂存世界（`ToolRuntime.world`）并记一条 `ToolStep`；
被拒的调用**只拒这一次**（把原因交回模型，它自己改），不整条回合判死。循环跑完仍未交付
才是不提交的失败（见 `dm/agent.py`）。

分工（这是本轨的骨架）：
- **学生声明动作的 `effects`/`reveals`** 由平台确定性结算（`runtime/world.py`）——判据、回放、
  时间尺都靠它可复算；
- **世界的回应**（数值怎么变、谁进来、什么被看见）由模型用这里的工具演绎；
- 平台只保留**账本、信息隔离与判据**：注册表（谁能写什么、什么能揭示、图要等哪条线索）、
  拒绝计数、以及落进事件载荷的步骤账。
"""

from __future__ import annotations

import json
from collections import Counter
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

from ..schema import Effect, EffectOp, Presence, ScenarioPack
from ..turns import AppliedEffect, DeliveryMessage, ToolStep
from .world import World, apply_effects, effective_presence, reveal_cues, state_label

MAX_TEXT = 600  # 一条台词/叙述的上限
MAX_ASK = 200  # 一次提问的上限
MAX_ADVANCE = 10  # `time_advance` 单次上限

#: 拒绝原因（机器可读）→ 进事件载荷与 /api/diagnose 计数
REASON_UNKNOWN_TOOL = "unknown_tool"
REASON_UNKNOWN_ARG = "unknown_arg"


def _obj(props: dict[str, Any], required: list[str]) -> dict[str, Any]:
    """strict 模式的 JSON Schema：全部属性必填 + 不许有额外键。"""
    return {"type": "object", "properties": props, "required": required, "additionalProperties": False}


_STR = {"type": "string"}
_TEXT = {"type": "string", "description": ""}
_NULLABLE_STR = {"type": ["string", "null"]}

#: 工具集（顺序 = 提示词里的顺序）。严格模式：`strict: true` + 全字段必填 + 无额外键。
TOOLS: list[dict[str, Any]] = [
    {
        "name": "world_set",
        "description": "改动一个**已登记**的状态值（读数、意识、配合度…）。写未登记的键会被拒绝。",
        "parameters": _obj({"key": _STR, "value": {"type": ["number", "boolean", "string"]}}, ["key", "value"]),
    },
    {
        "name": "cue_reveal",
        "description": "把一条已声明的线索揭示给学生（学生从此看得见它，判读也按它记账）。",
        "parameters": _obj({"id": _STR}, ["id"]),
    },
    {
        "name": "time_advance",
        "description": "让情境时间前进 n 个单位（1–10）。只前进，不回退；只在确实过去了一段时间时用。",
        "parameters": _obj({"n": {"type": "integer", "minimum": 1, "maximum": MAX_ADVANCE}}, ["n"]),
    },
    {
        "name": "actor_enter",
        "description": "让一个人物进入现场（例如被叫来的医生）。已声明为不可达的人进不来。",
        "parameters": _obj({"id": _STR}, ["id"]),
    },
    {
        "name": "actor_leave",
        "description": "让一个在场的人物离开现场。",
        "parameters": _obj({"id": _STR}, ["id"]),
    },
    {
        "name": "char_say",
        "description": "人物说一句话（显示为角色的台词）。`as_role` 只用于临时人物。",
        "parameters": _obj({"actor": _STR, "text": _TEXT, "as_role": _NULLABLE_STR}, ["actor", "text", "as_role"]),
    },
    {
        "name": "world_state",
        "description": "看当前所有已登记状态值（含学生此刻是否看得见它）。只读。",
        "parameters": _obj({}, []),
    },
    {
        "name": "actor_knows",
        "description": "看一个人物知道什么（声明的知识 + 他在场时见到的事）。只读。",
        "parameters": _obj({"id": _STR}, ["id"]),
    },
    {
        "name": "history_recent",
        "description": "看最近 n 个时间单位发生过什么。只读。",
        "parameters": _obj({"n": {"type": "integer", "minimum": 1, "maximum": 20}}, ["n"]),
    },
    {
        "name": "present_monitor",
        "description": "把一台设备的读数摆到学生面前（设备面板上出现它）。",
        "parameters": _obj({"device_id": _STR}, ["device_id"]),
    },
    {
        "name": "present_image",
        "description": "给学生看一张已声明的场景图片。声明了前置线索的图片要等线索揭示后才能发。",
        "parameters": _obj({"asset_id": _STR}, ["asset_id"]),
    },
    {
        "name": "present_ask",
        "description": "向学生提问/要求补充（学生看到一条「需要补充」）。",
        "parameters": _obj({"question": _TEXT}, ["question"]),
    },
    {
        "name": "note_write",
        "description": "给自己留一条备忘（只有教师回放看得到，学生看不到）。",
        "parameters": _obj({"text": _TEXT}, ["text"]),
    },
]

_TOOL_NAMES = [item["name"] for item in TOOLS]
_READ_ONLY = frozenset({"world_state", "actor_knows", "history_recent"})


def tool_schemas(mode: str) -> list[dict[str, Any]]:
    """给 `LLMClient.call_with_tools` 的 `tools` 参数。

    `hint`（求提示）是**只读**路径：只给读工具——世界不会被一次教学交互改写。
    """
    built: list[dict[str, Any]] = []
    for spec in TOOLS:
        if mode == "hint" and spec["name"] not in _READ_ONLY:
            continue
        built.append(
            {
                "type": "function",
                "function": {
                    "name": spec["name"],
                    "description": spec["description"],
                    "strict": True,
                    "parameters": spec["parameters"],
                },
            }
        )
    return built


@dataclass
class ToolRuntime:
    """一次模型循环的运行环境：**暂存世界** + 本回合的产出缓冲 + 步骤账。

    缓冲里的东西在提交时一并写进那一条 `turn_committed` 载荷；失败（未交付）则整个世界
    与缓冲一起丢掉——数据库里没有这一回合，世界不变。
    """

    pack: ScenarioPack
    world: World
    mode: str = "turn"
    steps: list[ToolStep] = field(default_factory=list)
    effects: list[AppliedEffect] = field(default_factory=list)
    reveals: list[str] = field(default_factory=list)
    messages: list[DeliveryMessage] = field(default_factory=list)
    asks: list[str] = field(default_factory=list)
    images: list[str] = field(default_factory=list)
    presented: list[str] = field(default_factory=list)
    presence: dict[str, str] = field(default_factory=dict)
    notes: list[str] = field(default_factory=list)
    rejections: Counter[str] = field(default_factory=Counter)
    time_advanced: int = 0
    #: 最终交付（`deliver`）——循环的终点，写在这里而不是 `steps` 里
    delivered: bool = False
    narration: str = ""

    # ── 派发 ──

    def handlers(self) -> dict[str, Callable[[dict[str, Any]], dict[str, Any]]]:
        table: dict[str, Callable[[dict[str, Any]], dict[str, Any]]] = {
            "world_set": self._set,
            "cue_reveal": self._reveal,
            "time_advance": self._advance,
            "actor_enter": self._enter,
            "actor_leave": self._leave,
            "char_say": self._say,
            "world_state": self._state,
            "actor_knows": self._knows,
            "history_recent": self._history,
            "present_monitor": self._monitor,
            "present_image": self._image,
            "present_ask": self._ask,
            "note_write": self._note,
        }
        if self.mode == "hint":
            return {name: fn for name, fn in table.items() if name in _READ_ONLY}
        return table

    def call(self, name: str, args: dict[str, Any]) -> str:
        """执行一次工具调用，返回给模型的 JSON（**永不抛异常**：拒绝也是一种结果）。"""
        handler = self.handlers().get(name)
        if handler is None:
            result: dict[str, Any] = {
                "ok": False,
                "reason": REASON_UNKNOWN_TOOL,
                "detail": f"这里没有这个工具：{name}",
            }
        elif self.delivered:
            result = {
                "ok": False,
                "reason": "already_delivered",
                "detail": "这一回合已经交付了。结束：不要再调用任何工具。",
            }
        else:
            try:
                result = handler(args if isinstance(args, dict) else {})
            except (AttributeError, IndexError, KeyError, TypeError, ValueError) as exc:
                # 数据形状类异常（模型给了怪参数 / 包内容有洞）：如实拒绝并记账，
                # 不让一次调用把整回合打没——模型读到原因还能换一种做法。
                result = {"ok": False, "reason": "tool_failed", "detail": f"这一步没做成：{type(exc).__name__}"}
        return self.record(name, args, result)

    def record(self, name: str, args: dict[str, Any], result: dict[str, Any]) -> str:
        """记账（每条工具调用都进步骤账，含 `deliver`）并把结果交回模型。"""
        ok = bool(result.get("ok"))
        reason = str(result.get("reason") or "")
        self.steps.append(
            ToolStep(
                tool=name,
                args=dict(args) if isinstance(args, dict) else {},
                ok=ok,
                reason=reason,
                detail=str(result.get("detail") or ""),
            )
        )
        if not ok:
            self.rejections[reason or REASON_UNKNOWN_TOOL] += 1
        return json.dumps(result, ensure_ascii=False)

    # ── 世界类 ──

    def _set(self, args: dict[str, Any]) -> dict[str, Any]:
        key = str(args.get("key") or "")
        if key not in self.pack.state_keys:
            return {"ok": False, "reason": "key_unregistered", "detail": f"{key} 不是已登记的状态键"}
        value = args.get("value")
        initial = self.pack.state_keys[key]
        if not _same_kind(initial, value):
            return {
                "ok": False,
                "reason": "type_mismatch",
                "detail": f"{key} 的类型是 {_kind_name(initial)}，不能写 {_kind_name(value)}",
            }
        bound = self.pack.state_bounds.get(key)
        if bound is not None and isinstance(value, (int, float)) and not isinstance(value, bool):
            if bound.lo is not None and value < bound.lo:
                return {"ok": False, "reason": "out_of_range", "detail": f"{key} 不能低于 {bound.lo}"}
            if bound.hi is not None and value > bound.hi:
                return {"ok": False, "reason": "out_of_range", "detail": f"{key} 不能高于 {bound.hi}"}
        effect = Effect(target=key.split(".", 1)[0], key=key, op=EffectOp.SET, value=value)
        self.effects += apply_effects(self.pack, self.world, [effect], source="tool:world_set")
        return {"ok": True, "key": key, "value": self.world.state.get(key), "label": state_label(self.pack, key)}

    def _reveal(self, args: dict[str, Any]) -> dict[str, Any]:
        cue_id = str(args.get("id") or "")
        cue = self.pack.cue(cue_id)
        if cue is None:
            return {"ok": False, "reason": "cue_unknown", "detail": f"{cue_id} 不是已声明的线索"}
        if cue_id in self.world.revealed:
            return {"ok": True, "id": cue_id, "already": True, "text": cue.text}
        self.reveals += reveal_cues(self.pack, self.world, [cue_id])
        return {"ok": True, "id": cue_id, "already": False, "text": cue.text}

    def _advance(self, args: dict[str, Any]) -> dict[str, Any]:
        raw = args.get("n")
        if isinstance(raw, bool) or not isinstance(raw, int) or not 1 <= raw <= MAX_ADVANCE:
            return {"ok": False, "reason": "bad_amount", "detail": f"n 必须是 1..{MAX_ADVANCE} 的整数"}
        self.world.turn += raw
        self.time_advanced += raw
        return {"ok": True, "n": raw, "time": self.world.turn}

    def _enter(self, args: dict[str, Any]) -> dict[str, Any]:
        actor = self.pack.actor(str(args.get("id") or ""))
        if actor is None:
            return {"ok": False, "reason": "unknown_actor", "detail": "没有这个人物"}
        if actor.presence is Presence.INACCESSIBLE:
            return {"ok": False, "reason": "presence_forbidden", "detail": f"{actor.role}不可能出现在这里"}
        self.world.presence[actor.id] = Presence.ON_SITE.value
        self.presence[actor.id] = Presence.ON_SITE.value
        return {"ok": True, "id": actor.id, "role": actor.role, "presence": Presence.ON_SITE.value}

    def _leave(self, args: dict[str, Any]) -> dict[str, Any]:
        actor = self.pack.actor(str(args.get("id") or ""))
        if actor is None:
            return {"ok": False, "reason": "unknown_actor", "detail": "没有这个人物"}
        if effective_presence(self.pack, self.world, actor.id) is not Presence.ON_SITE:
            return {"ok": False, "reason": "not_on_site", "detail": f"{actor.role}此刻不在现场"}
        self.world.presence[actor.id] = Presence.REMOTE.value
        self.presence[actor.id] = Presence.REMOTE.value
        return {"ok": True, "id": actor.id, "role": actor.role, "presence": Presence.REMOTE.value}

    # ── 人物类 ──

    def _say(self, args: dict[str, Any]) -> dict[str, Any]:
        text = _clean(str(args.get("text") or ""), MAX_TEXT)
        if not text:
            return {"ok": False, "reason": "empty_text", "detail": "台词是空的"}
        leak = _leak_in(self.pack, self.world, text)
        if leak is not None:
            return {
                "ok": False,
                "reason": "text_leak",
                "detail": f"这句话会把学生还不该知道的东西直接说出来（命中「{leak[:12]}」）。"
                "先用 cue_reveal 让线索可见，或者换成学生能观察到的说法。",
            }
        actor_id, as_role, ephemeral = self._speaker(str(args.get("actor") or ""), args.get("as_role"))
        if actor_id is None and not as_role:
            return {"ok": False, "reason": "unknown_speaker", "detail": "没有这个人物；临时人物必须给 as_role"}
        if any(message.speaker == actor_id and message.text == text for message in self.messages):
            # 同一回合里重说同一句：**幂等收下**（世界已经是这个状态了），不再追加第二个气泡。
            # 不用"拒绝"：实测里拒绝会让模型反复重发同一轮，把步数耗光、整个回合都不交付。
            return {
                "ok": True,
                "duplicate": True,
                "detail": "这句话这一回合已经说过了，不再重复；可以继续说，或 deliver 交付",
            }
        self.messages.append(DeliveryMessage(speaker=actor_id, as_role=as_role, ephemeral=ephemeral, text=text))
        return {"ok": True, "speaker": actor_id or as_role, "text": text}

    def _speaker(self, raw: str, as_role_arg: Any) -> tuple[str | None, str, bool]:
        """说话人归一：id → 唯一角色名 → 临时角色（须给显示名）。"""
        as_role = _clean(str(as_role_arg or ""), 40)
        if self.pack.actor(raw) is not None:
            return raw, as_role, False
        role_hits = [actor for actor in self.pack.actors if actor.role == raw]
        if len(role_hits) == 1:
            return role_hits[0].id, as_role, False
        return None, as_role, True

    # ── 读取类 ──

    def _state(self, _args: dict[str, Any]) -> dict[str, Any]:
        exposed = self.exposed_keys()
        rows = [
            {
                "key": key,
                "label": state_label(self.pack, key),
                "value": self.world.state.get(key),
                "student_sees": key in exposed,
            }
            for key in self.pack.state_keys
        ]
        return {"ok": True, "time": self.world.turn, "state": rows}

    def _knows(self, args: dict[str, Any]) -> dict[str, Any]:
        actor = self.pack.actor(str(args.get("id") or ""))
        if actor is None:
            return {"ok": False, "reason": "unknown_actor", "detail": "没有这个人物"}
        return {
            "ok": True,
            "id": actor.id,
            "role": actor.role,
            "presence": effective_presence(self.pack, self.world, actor.id).value,
            "declared": actor.knowledge,
            "witnessed": self.witnessed(),
        }

    def _history(self, args: dict[str, Any]) -> dict[str, Any]:
        raw = args.get("n")
        if isinstance(raw, bool) or not isinstance(raw, int) or not 1 <= raw <= 20:
            return {"ok": False, "reason": "bad_amount", "detail": "n 必须是 1..20 的整数"}
        return {
            "ok": True,
            "time": self.world.turn,
            "recent": self.world.transcript(self.pack, limit=raw) or "（还没有）",
        }

    # ── 呈现类 ──

    def _monitor(self, args: dict[str, Any]) -> dict[str, Any]:
        device_id = str(args.get("device_id") or "")
        device = self.pack.device(device_id)
        if device is None:
            return {"ok": False, "reason": "unknown_device", "detail": "没有这台设备"}
        if device_id not in self.world.presented:
            self.world.presented.append(device_id)
            self.presented.append(device_id)
        return {"ok": True, "device_id": device_id, "title": device.title}

    def _image(self, args: dict[str, Any]) -> dict[str, Any]:
        asset_id = str(args.get("asset_id") or "")
        asset = self.pack.asset(asset_id)
        if asset is None:
            return {"ok": False, "reason": "unknown_asset", "detail": "没有这张图"}
        if asset.reveal_with and not any(cue_id in self.world.revealed for cue_id in asset.reveal_with):
            # 闸门：提前发**只拒这一次**，并记账（不整条回合判死）。
            return {
                "ok": False,
                "reason": "image_gated",
                "detail": "这张图要等对应的线索被揭示之后才能给学生看；先 cue_reveal。",
            }
        if asset_id not in self.images:
            self.images.append(asset_id)
            self.world.images.append({"asset_id": asset_id, "caption": "", "origin": "pack"})
        return {"ok": True, "asset_id": asset_id, "title": asset.title}

    def _ask(self, args: dict[str, Any]) -> dict[str, Any]:
        question = _clean(str(args.get("question") or ""), MAX_ASK)
        if not question:
            return {"ok": False, "reason": "empty_text", "detail": "问题是空的"}
        leak = _leak_in(self.pack, self.world, question)
        if leak is not None:
            return {"ok": False, "reason": "text_leak", "detail": f"这个问题会泄底（命中「{leak[:12]}」）"}
        if question not in self.asks:
            self.asks.append(question)
        return {"ok": True, "question": question}

    # ── 自语 ──

    def _note(self, args: dict[str, Any]) -> dict[str, Any]:
        text = _clean(str(args.get("text") or ""), MAX_TEXT)
        if not text:
            return {"ok": False, "reason": "empty_text", "detail": "备忘是空的"}
        self.notes.append(text)
        return {"ok": True}

    # ── 派生 ──

    def exposed_keys(self) -> set[str]:
        """学生此刻可能看见的状态键：设备通道 ∪ 已被 `present_monitor` 摆出来的设备通道。"""
        exposed: set[str] = set()
        for device in self.pack.presentation.devices:
            if device.id in self.world.presented or device.visible_when is None:
                exposed |= {channel.ref for channel in device.channels}
        return exposed

    def witnessed(self, limit: int = 6) -> list[str]:
        """**由事件流推导**的"在场者共见的事"：已揭示线索 + 最近几次尝试/台词。"""
        pieces = [f"线索「{text}」" for _, text in self.pack.cue_items(self.world.revealed)]
        pieces += [f"[学生] {action.label(self.pack)}" for action in self.world.actions]
        pieces += [f"[{entry.get('actor')}] {entry.get('text')}" for entry in self.world.lines]
        return pieces[-limit:]


# --------------------------------------------------------------------------- #
# 小工具
# --------------------------------------------------------------------------- #


def _clean(text: str, limit: int) -> str:
    collapsed = " ".join(text.split())
    return collapsed[:limit]


def _kind_name(value: Any) -> str:
    if isinstance(value, bool):
        return "布尔"
    if isinstance(value, (int, float)):
        return "数值"
    if isinstance(value, str):
        return "文本"
    return type(value).__name__


def _same_kind(initial: Any, value: Any) -> bool:
    """类型必须与登记初值同类（布尔**不**算数值）。"""
    if isinstance(initial, bool):
        return isinstance(value, bool)
    if isinstance(initial, (int, float)):
        return isinstance(value, (int, float)) and not isinstance(value, bool)
    if isinstance(initial, str):
        return isinstance(value, str)
    return initial is None


def _leak_in(pack: ScenarioPack, world: World, text: str) -> str | None:
    """学生可见文本里不得出现未获准的短语（延迟导入避免与 agent 模块互相引用）。"""
    from ..dm.agent import leak_terms

    return next((term for term in leak_terms(pack, world) if term in text), None)
