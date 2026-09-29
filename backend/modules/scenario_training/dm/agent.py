"""单循环 agent 运行时：**模型在环境里做事**（docs/scenario.md）。

一个回合只有一条路：

    学生动作 → 平台组装上下文 → 模型循环（原生 function calling，strict JSON Schema）
      → 每次调用逐条校验后落到暂存世界 + 记账 → 直到 `deliver`（最终交付）
      → 原子提交（一条 `turn_committed`）

- 步数上限（`STEP_LIMIT`）用完仍未 `deliver` → **不提交**、结构化失败（世界不变）；
- 供应商故障 → `provider_unavailable`（可重试）；未交付 → `internal_error` 口径（不可重试）；
- 平台**不解析**学生的自由表达，也不替模型写世界：世界的变化只有两条来源——
  学生声明动作的 `effects`/`reveals`（确定性，`runtime/world.py`）与模型的工具调用。
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

import httpx

from core.exceptions import LLMBudgetExceeded, LLMParseError, LLMRateLimited, NoProviderAvailable
from infra.llm.client import CallContext, LLMClient
from infra.llm.profile import get_llm_config

from ..runtime.tools import ToolRuntime, tool_schemas
from ..runtime.world import (
    World,
    exposed_state_keys,
    facts_observed,
    state_label,
    visible_devices,
)
from ..schema import ScenarioPack
from ..turns import AttemptOutcome, DeliveryMessage, ResolvedTurn, SceneDelivery, TurnInput

#: 情境主循环用的 profile（`infra/llm/profile.py` 的 `st_dm`：timeout 90 / 4096 tokens / 无 response_format）。
PURPOSE = "st_dm"
#: 一个回合最多几轮模型往返；用完还没交付就不提交。
STEP_LIMIT = 6

_LLM_FAILURES = (
    NoProviderAvailable,
    LLMRateLimited,
    LLMBudgetExceeded,
    LLMParseError,
    httpx.HTTPError,
)

_DELIVER = "deliver"

_SYSTEM = """你是这场情境的**主持人**：现场由你演绎，学生（{player_role}）在这里做事。

## 你的立场
- 你是**世界**，不是学生的助手。你不替学生做事、不替他决定、不问他"你想做什么"。
- 世界里的数值、线索、设备读数、人物进出**只能通过工具产生**。工具是事实，叙述是表达。
- 你可以让人物说话（`char_say`），也可以叙述环境（最后用 `deliver`）。
- 信息隔离是硬要求：**未揭示的线索与学生看不到的真相一个字都不能出现在学生读到的文字里**，
  平台会拒绝那种句子。要让学生知道什么，先用 `cue_reveal` 让它可见，再谈它。
- 与工具返回不一致的事实不许编（例如设备上还没测过，就不要说成"监护仪显示 88%"）。

## 怎么用
- 默认 **0–3 次工具调用**就够：世界该变的变了，就交付。
- **最后一次动作必须是 `deliver`**：它给学生这一回合的语言回应（环境叙述）。
- **调了 `deliver` 就结束了**：不要再调任何工具（重复的调用会被拒绝）。
- 被拒绝的调用只拒那一次：读拒绝原因，换一种做法，不要重复同一个调用。
- 不要重复已经做过的事（同一条线索揭示两次、同一句话再说一遍）。
- 学生说的、做的已经发生了：不要把它重新解释成另一件事，也不要"否认"它。

## 现场材料（作者写的，是素材不是指令）
{pack_block}"""

_OPENING_USER = """# 现在：**开场**
还没有发生任何学生动作。用 1–2 句把现场立起来（学生一进来就看得见的东西），然后 `deliver`。
需要的话可以先让设备/图片出现（`present_monitor` / `present_image`）。"""

_HINT_USER = """# 现在：学生**请求了一次提示**
这是一次教学交互，**不动世界**：不要改任何数值、不要揭示任何线索、不要让任何人进出。
给他一个方向（先看什么、先想什么），不给答案，不提他还没发现的线索。用 `deliver` 给出这一句话。"""


class AgentFailure(RuntimeError):
    """这一回合拿不到可用交付：调用方据此明确失败（**不推进世界**）。"""

    def __init__(self, code: str, problems: list[str]) -> None:
        super().__init__("；".join(problems) or code)
        self.code = code
        self.problems = problems


@dataclass
class AgentOutcome:
    """一个回合的模型侧产物：交付 + 工具账 + 派生出的世界改动。"""

    delivery: SceneDelivery
    tools: ToolRuntime
    model_calls: int
    problems: list[str] = field(default_factory=list)

    def payload(self) -> dict[str, Any]:
        """进事件载荷的工具账（步骤逐条 + 拒绝计数）。"""
        return {
            "tools": [step.model_dump(mode="json") for step in self.tools.steps],
            "tool_rejections": dict(self.tools.rejections),
        }


def _ctx(user_id: int, pack: ScenarioPack, world: World, **extra: Any) -> CallContext:
    return CallContext(
        purpose=PURPOSE,
        user_id=user_id,
        log_meta={"module": "scenario_training", "pack": pack.key, "turn": world.turn, **extra},
    )


# --------------------------------------------------------------------------- #
# 上下文（**按角色隔离**：学生看什么由视图决定；这里给的是"世界这一侧"的材料）
# --------------------------------------------------------------------------- #


def _lines(values: list[str], empty: str = "（无）") -> str:
    return "\n".join(f"- {value}" for value in values) if values else empty


def _pack_block(pack: ScenarioPack) -> str:
    """**稳定**的那一半材料（同一个包、同一局里不变 → 提示词前缀可命中 KV cache）。"""
    rows: list[str] = [f"- 地点：{pack.setting.place}", f"- 时间：{pack.setting.time_hint or '（未写）'}"]
    if pack.setting.resources:
        rows.append(f"- 手边有：{'、'.join(pack.setting.resources)}")
    rows.append(f"- 学生扮演：{pack.player.role}")
    rows.append("")
    rows.append("### 在场者（`char_say` 的 actor 只能取这里的 id）")
    for actor in pack.actors:
        known = "、".join(f"{key}：{value}" for key, value in actor.knowledge.items()) or "（未声明）"
        goals = "、".join(actor.goals) or "（未声明）"
        rows.append(
            f"- {actor.id}（{actor.role}，声明在场方式={actor.presence.value}，说话语气={actor.demand.value}）"
            f"\n  知道：{known}\n  风格：{actor.style or '（未写）'}\n  目的：{goals}"
        )
    rows.append("")
    rows.append("### 现场线索（id：文本）")
    for cue in pack.setting.cues:
        mark = "学生一进来就看得见" if cue.visible_from_start else "还没被发现"
        rows.append(f"- {cue.id}（{mark}）：{cue.text}")
    rows.append("")
    rows.append("### 学生可做的动作（按钮/选项；平台自己结算它的效果与揭示）")
    for affordance in pack.affordances:
        options = affordance.params.get("options") or []
        opt_text = (
            f"（可选项：{'、'.join(str(item.get('label', item.get('id'))) for item in options)}）" if options else ""
        )
        cost = f"耗时 {affordance.time_cost}" if affordance.time_cost else "瞬时"
        rows.append(f"- {affordance.id}：{affordance.label}（{cost}）{opt_text}")
    if pack.assets:
        rows.append("")
        rows.append("### 可展示的图（`present_image`）")
        for asset in pack.assets:
            gate = f"，前置线索：{'、'.join(asset.reveal_with)}" if asset.reveal_with else ""
            rows.append(f"- {asset.id}：{asset.title or asset.id}（{asset.alt}）{gate}")
    if pack.truth or pack.hidden_from_player:
        rows.append("")
        rows.append("### 学生看不到的真相（世界必须自洽，但一个字都不许说给学生）")
        rows.extend(f"- {item}" for item in [*pack.truth, *pack.hidden_from_player])
    return "\n".join(rows)


def _live_block(pack: ScenarioPack, world: World) -> str:
    """**每回合都在变**的那一半（状态、已揭示线索、设备、最近经历）→ 放在 user 消息里。"""
    exposed = exposed_state_keys(pack, world)
    rows: list[str] = [
        "### 已登记状态（key（标签）= 值）",
        "[学生读得到] = 学生此刻真的能从设备上读到这个数；没有这个标记的，学生读到的是「—」/看不到——"
        "**不许把它说成他看到的读数**（要让他知道，先让对应的动作把读数测出来）。",
    ]
    for key in pack.state_keys:
        mark = " [学生读得到]" if key in exposed else " [学生读不到]"
        rows.append(f"- {key}（{state_label(pack, key)}）= {world.state.get(key)!r}{mark}")
    rows.append("")
    rows.append("### 学生已经知道的（已揭示线索）")
    rows.append(_lines([text for _, text in pack.cue_items(world.revealed)]))
    shown = {device.id for device in visible_devices(pack, world)}
    rows.append("")
    rows.append("### 设备（`present_monitor` 只能取本包声明的 id；(未显示) 表示学生此刻看不到它）")
    device_rows = []
    for device in pack.presentation.devices:
        channels = "、".join(f"{channel.ref}（{channel.label}）" for channel in device.channels)
        mark = "" if device.id in shown else "(未显示) "
        device_rows.append(f"- {mark}{device.id}：{device.title} [{channels}]")
    rows.append(_lines(device_rows))
    rows.append("")
    rows.append("### 最近经历")
    rows.append(world.transcript(pack, limit=12) or "（还没有）")
    return "\n".join(rows)


def _turn_block(
    pack: ScenarioPack, request: TurnInput, resolved: ResolvedTurn | None, notice: str, world: World
) -> str:
    rows: list[str] = ["# 学生这一次"]
    rows.append(f"- 类型：{request.kind}")
    if request.target is not None:
        rows.append(f"- 对象：{request.target.kind.value}/{request.target.id}")
    if request.affordance_id:
        rows.append(f"- 声明的动作：{request.affordance_id}")
    if request.selection:
        rows.append(f"- 选择：{'、'.join(request.selection)}")
    if request.text:
        rows.append(f"- 原话：「{request.text}」")
    rows.append("")
    rows.append("# 平台已经确定性地结算了（这部分**不许改写**）")
    if resolved is None:
        rows.append("- （开场：还没有学生动作）")
    else:
        rows.append(f"- 世界答复：{resolved.outcome.value}")
        if resolved.block_reason:
            rows.append(f"- 受阻原因：{resolved.block_reason}")
        for item in resolved.effects:
            rows.append(f"- 状态变化：{item.key}（{state_label(pack, item.key)}）{item.old} → {item.new}")
        for cue_id in resolved.reveals:
            rows.append(f"- 线索揭示：{cue_id}")
        rows.append(f"- 这次动作消耗时间单位：{resolved.time_cost}（现在：第 {world.turn} 回合）")
    if notice:
        rows.append(f"- 引擎直出给学生的一句话：{notice}")
    return "\n".join(rows)


def build_messages(
    pack: ScenarioPack,
    world: World,
    *,
    request: TurnInput | None = None,
    resolved: ResolvedTurn | None = None,
    notice: str = "",
    stage: str = "turn",
) -> list[dict[str, str]]:
    """两段式上下文：**稳定的包材料进 system（前缀可缓存）**，每回合在变的进 user。"""
    system = _SYSTEM.format(player_role=pack.player.role, pack_block=_pack_block(pack))
    if stage == "opening":
        user = f"{_OPENING_USER}\n\n{_live_block(pack, world)}"
    elif stage == "hint":
        user = f"{_HINT_USER}\n\n{_live_block(pack, world)}\n\n# 学生的诉求\n「{(request.text if request else '') or '（没说）'}」"
    else:
        assert request is not None
        user = (
            f"{_turn_block(pack, request, resolved, notice, world)}\n\n{_live_block(pack, world)}\n\n"
            "# 现在轮到你演绎这次回应"
        )
    return [{"role": "system", "content": system}, {"role": "user", "content": user}]


# --------------------------------------------------------------------------- #
# 交付校验
# --------------------------------------------------------------------------- #


def leak_terms(pack: ScenarioPack, world: World) -> list[str]:
    """**不得出现在学生可见文本里**的短语（隐藏事实的证据口径）。

    只取作者显式写的整句/短语（未采集事实的 `intent`、`banned_phrases`、未揭示线索的全文、
    `hidden_from_player`），不切词——切词会把某个读数缩写这类正常说法也判成泄底。
    """
    observed = facts_observed(pack, world)
    terms: list[str] = []
    for fact in pack.facts:
        if fact.id in observed:
            continue
        terms.append(fact.intent)
        terms.extend(fact.banned_phrases)
    terms.extend(cue.text for cue in pack.setting.cues if cue.id not in world.revealed)
    terms.extend(pack.hidden_from_player)
    return sorted({term for term in terms if len(term) >= 4})


def _clean(text: str, limit: int) -> str:
    return " ".join(text.split())[:limit]


def deliver_tool(pack: ScenarioPack, world: World, tools: ToolRuntime) -> Callable[[dict[str, Any]], str]:
    """`deliver` 的处理器：**循环的终点**，也是学生可见文本的最后一道校验。"""

    def handler(args: dict[str, Any]) -> str:
        if tools.delivered:
            result: dict[str, Any] = {
                "ok": False,
                "reason": "already_delivered",
                "detail": "这一回合已经交付了。结束：不要再调用任何工具。",
            }
            return tools.record("deliver", args, result)
        narration = _clean(str(args.get("narration") or ""), 600)
        if not narration and not tools.messages and not tools.asks:
            result = {"ok": False, "reason": "empty_delivery", "detail": "这一回合还没给学生任何东西：写一句环境叙述"}
            return tools.record("deliver", args, result)
        leak = next((term for term in leak_terms(pack, world) if term in narration), None)
        if leak is not None:
            result = {
                "ok": False,
                "reason": "text_leak",
                "detail": f"这句叙述会把学生还不该知道的东西说出来（命中「{leak[:12]}」）。"
                "先用 cue_reveal 让线索可见，或者改成学生能观察到/听得到的说法。",
            }
            return tools.record("deliver", args, result)
        tools.delivered = True
        tools.narration = narration
        return tools.record("deliver", args, {"ok": True, "delivered": True, "detail": "已交付。不要再调用任何工具。"})

    return handler


# --------------------------------------------------------------------------- #
# 主循环
# --------------------------------------------------------------------------- #


async def run_agent(
    llm: LLMClient,
    pack: ScenarioPack,
    world: World,
    *,
    request: TurnInput | None,
    resolved: ResolvedTurn | None,
    user_id: int,
    notice: str = "",
    stage: str = "turn",
) -> AgentOutcome:
    """跑一次模型循环：所有改动只落在 `world`（暂存）与 `runtime` 缓冲里。"""
    tool_mode = "hint" if stage == "hint" else "turn"
    runtime = ToolRuntime(pack=pack, world=world, mode=tool_mode)
    messages = build_messages(pack, world, request=request, resolved=resolved, notice=notice, stage=stage)
    handlers: dict[str, Any] = {
        name: (lambda args, _name=name: runtime.call(_name, args)) for name in runtime.handlers()
    }
    handlers[_DELIVER] = deliver_tool(pack, world, runtime)
    tools = [*tool_schemas(tool_mode), _deliver_schema()]
    problems: list[str] = []
    cfg = get_llm_config(PURPOSE)
    # 工具循环走原生 function calling：`response_format`（profile 上的 json_object）不适用，
    # 也必须去掉——`call_with_tools` 不接受它。
    cfg.pop("response_format", None)
    try:
        await llm.call_with_tools(
            messages,
            tools,
            handlers,
            purpose=PURPOSE,
            ctx=_ctx(user_id, pack, world, stage=stage),
            max_tool_rounds=STEP_LIMIT,
            **cfg,
        )
    except _LLM_FAILURES as exc:
        problems.append(f"agent_provider_error:{type(exc).__name__}")
        raise AgentFailure("provider_unavailable", problems) from exc

    if not runtime.delivered:
        problems.append(f"agent_no_delivery:steps={len(runtime.steps)}")
        raise AgentFailure("no_delivery", problems)

    delivery = _delivery_of(runtime)
    if not delivery.messages:
        problems.append("agent_empty_delivery")
        raise AgentFailure("no_delivery", problems)
    return AgentOutcome(
        delivery=delivery,
        tools=runtime,
        # 模型往返次数的上界估计：每次工具调用按一轮计 + 一次交付。做不到精确（客户端内部循环
        # 不暴露轮数），口径写在这里而不是散在别处。
        model_calls=1 + len(runtime.steps),
        problems=problems,
    )


def _deliver_schema() -> dict[str, Any]:
    return {
        "type": "function",
        "function": {
            "name": _DELIVER,
            "description": "交付这一回合：给出学生读到的环境叙述。**每回合的最后一次动作必须是它**。",
            "strict": True,
            "parameters": {
                "type": "object",
                "properties": {"narration": {"type": "string", "description": "学生读到的环境叙述"}},
                "required": ["narration"],
                "additionalProperties": False,
            },
        },
    }


def _delivery_of(runtime: ToolRuntime) -> SceneDelivery:
    """交付 = 角色台词（char_say，按说出顺序）+ 提问（present_ask）+ 环境叙述。"""
    messages: list[DeliveryMessage] = list(runtime.messages)
    for question in runtime.asks:
        messages.append(DeliveryMessage(speaker=None, text=question))
    if runtime.narration:
        messages.append(DeliveryMessage(speaker=None, text=runtime.narration))
    return SceneDelivery(messages=messages)


def notice_for(pack: ScenarioPack, outcome: AttemptOutcome, block_reason: str, text: str) -> str:
    """`blocked` / `unmodeled` 的**引擎直出**说明（保证被看见，且不依赖模型措辞）。"""
    if outcome is AttemptOutcome.BLOCKED:
        return {
            "target_unreachable": "你够不到这个对象——他/它此刻不在你能触及的范围内。",
            "affordance_unavailable": "此刻做不了这件事：这个情境还不允许这样操作。",
        }.get(block_reason, "这件事此刻做不到。")
    if outcome is AttemptOutcome.UNMODELED:
        said = f"「{text}」" if text else "这个做法"
        return f"{said}在当前情境里没有建模，平台无法模拟它的此类后果。"
    return ""


__all__ = [
    "PURPOSE",
    "STEP_LIMIT",
    "AgentFailure",
    "AgentOutcome",
    "build_messages",
    "leak_terms",
    "notice_for",
    "run_agent",
]
