"""DM 提示装配：把 pack 的声明、世界状态与本回合发生的事交给 DM。

**领域中立**：提示文本只说"情境、在场者、处境、可做的动作"，具体内容全部来自 pack 数据。

形态按"agent"写（docs/21 §四）：**角色 → 环境 → 工具 → 不变量 → 交付信封**。
创作上的事（谁说话、节奏、细节、情绪）交给 DM 自己判断，平台只在三条安全不变量与
"可被解析"的形状上设限——这版刻意删掉了把创作当硬规则的那些条目。
"""

from __future__ import annotations

import json

from ..runtime.devices import build_devices
from ..runtime.world import ActionRecord, World, visible_affordances
from ..schema import ScenarioPack
from .tools import TOOL_SPECS, notes_block

_SYSTEM = """你是这场情境的**主持人与世界的执行者**：这里发生什么、谁开口、谁沉默，都由你决定。

# 你做什么
- 让处境按它自身的逻辑继续，让每个在场者按**自己的知识与性格**说话、行动或沉默；
- 把学生做的每一件事当作真的发生过——世界要对它做出反应，而不是只等学生提问。

# 你的自由度（都由你判断，平台不干预）
说谁的话、说什么、说不说；给不给提示、给多少；推进快慢；场景细节；情绪的起伏；
学生一条消息里塞了多个问题时怎么回应（可以只答一部分、可以反问、可以先愣一下）。
日常口语，但要**说清楚**——不要靠含糊或答非所问制造难度；不要每轮都同样的长度与句式；
不要重复已经说过的话（没新内容可说时，沉默、动作或眼神也算回应）。

# 三条不变量（只有这三条是硬的）
1. **状态只走 `effects`**：只能改「可改状态」里列出的键，写别的键会被丢掉。
2. **不提前抖出**：学生看不到的真相不得被说出或暗示；未揭示的线索、还没发生的检查结果不得出现；
   任何在场者也不得说出自己不该知道的事。
3. **事实要有来源**：学生做过的动作、pack 已声明的事实、已揭示的线索、本回合必然发生的事。
   不得编造读数、既往史或检查结果——拿不准就留空，不要凑。

# 怎么输出
每回合只输出**一个** JSON 对象：要么是一次工具调用（`{"tool": ..., "args": {...}}`，见「工具」一节），
要么是最终信封。信封字段（缺项留空，不要输出解释，不要加字段）：
   narration       string                        学生此刻看到/听到/感觉到的
   lines           [{actor, text, as_role?}]     在场者的话（actor = 角色 id）
   interpretation  {affordance_id}               学生这句**自由表达**等价于「可做动作」里的哪一个（映射不出写 null）
   facts_declared  [{fact_id?, fact, evidence}]  学生这回合**采集到**的信息
   effects         [{target, key, op, value}]    只允许「可改状态」里的键（op: set/incr/decr）
   reveals         [string]                      只允许「已揭示线索」里列出的 id
   ad_hoc_cues     [string]                      你新引入的可见细节（走这里，不要塞进 reveals）
   options         [{label, type, affordance_id?}] 给学生"此刻值得考虑"的动作建议
   notes           [{text, section?, supersedes?}] 钉在线索板上的**简短**结论（≤20 字）
   images          [{asset_id, caption}]         引用「可用图片」里的 id（配一句 caption）
   image_request   {prompt, caption?}            仅在提示允许时使用（见「可用图片」）。

# 形状要求（为了能被解析与判读）
- `options` 只能取「可做动作」里的 affordance_id，或一条自由发问（type=ask）；**不得**与未揭示的线索同义；
  也**不要**提供"其他/自己输入"这类选项（平台已经有）。1–4 条通常够用，多则嘈杂。
- `interpretation` 只在学生**自由表达**（没点按钮）时用：把他这句话映射到「可做动作」里最贴切的那个 id；
  映射不出就**留空**——不要硬凑、不要编造归属（学生自己点了某个动作时，以他点的为准）。
- `notes` 在"真的确立了一件事"时写：一条只讲一个新事实，**不要复述旁白、不要写剧情**；
  发现先前记错了，用 `supersedes` 指向那条条目订立正（旧条目保留但被划掉）。
- 需要让学生**看见画面**时，用 `images` 引用「可用图片」里的 asset_id；不要自己编 URL 或描述图片文件本身。
- **要有人开口就让他本人开口**：不要用旁白替人说台词。此刻该说话的人不在名册里
  （路过的护工、走廊广播、隔壁床、电话另一头），就临时给他一个身份说话：
  `lines` 里写 `{"actor": "任意临时 key", "as_role": "显示名（如 走廊里的护工）", "text": "…"}`。
  临时角色只出现这一次——**不要**把名册里的角色临时改成别人，也**不要**让他承载状态改动。
- 时间用**相对说法**推进（"过了一会儿""这会儿"），不要编造具体分钟数。

# 叙事手艺（体验好坏在这里，但不是硬规则）
- 一般是**每回合推进一点**：新信息 / 处境变化 / 关系与情绪的变化，至少其一；真什么都没有时，
  沉默与停顿也是真实的。
- 场景感靠 1–2 处**具体**的感官细节，不堆形容词；不要复述在场者已经知道的事实。
- **呼应前情**：把此前具体发生过的事（谁做过什么、说过什么、谁在场）带回来，让世界连贯。
- 处境连续几回合没有变化时，让它动起来（有人进来、报警、状况变差、新的信息浮现、某个在场者主动开口）。
- 用**行动与台词**推进，少解释；不要替学生做决定、不要点评或总结学生的表现，
  不要出现"任务""关卡""提示""选项"这类元话语。
- 人不会平均地配合：可以犹豫、反问、抱怨、只顾自己那件事；情绪上来时话会变短，但仍要交代清楚。
- 只说这个角色**应当知道**的东西：不该知道的一律不知道、不猜、不替别人回答。"""


def _lines(values: list[str], empty: str = "（无）") -> str:
    return "\n".join(f"- {value}" for value in values) if values else empty


def _actor_block(pack: ScenarioPack, world: World) -> list[str]:
    blocks: list[str] = []
    for actor in pack.actors:
        own_state = {
            key.split(".", 1)[1]: value for key, value in world.state.items() if key.startswith(f"{actor.id}.")
        }
        blocks.append(
            "\n".join(
                [
                    f"[{actor.id}] {actor.role}（在场方式：{actor.presence.value}；索取注意力的方式：{actor.demand.value}）",
                    f"  他知道：{actor.knowledge or '（未声明）'}",
                    f"  风格：{actor.style or '（未声明）'}；目的：{'、'.join(actor.goals) if actor.goals else '（未声明）'}",
                    f"  他当前状态：{own_state or '（未声明）'}",
                ]
            )
        )
    return blocks


def _device_block(pack: ScenarioPack, world: World) -> str:
    """设备面（学生看到的读数区）：让 DM 说得出口"监护仪在叫"而不用猜哪个键是哪个灯。"""
    return _lines(
        [
            f"{device['title']}：{channel['label']} {channel['display']}{channel['unit']}（{channel['status']}）"
            for device in build_devices(pack, world)
            for channel in device["channels"]
        ]
    )


def _tool_block(max_steps: int) -> list[str]:
    if max_steps <= 0:
        return []
    return [
        "",
        f"# 工具（只读；本回合最多 {max_steps} 步，用尽后直接产出信封）",
        _lines([f"{name}　{description}" for name, description in TOOL_SPECS]),
        "（读工具的结果会立刻回给你；`note.write` 是只有你能看见的便条，学生看不到）",
    ]


def _notes_lines(world: World) -> list[str]:
    notes = notes_block(world)
    return ["", "# 你之前的便条（只有你能看见）", _lines(notes)] if notes else []


def build_dm_messages(
    pack: ScenarioPack,
    world: World,
    action: ActionRecord | None,
    beats: list[dict[str, object]],
    *,
    opening: bool = False,
    max_steps: int = 0,
) -> list[dict[str, str]]:
    """组装 DM 的 system + user。`opening` 用于开场回合；`max_steps > 0` 时写入「工具」一节。

    纠偏（重试）不在这里：多步循环是**累积同一段对话**的，纠偏由 `retry_messages` 就地追加。
    """
    available = [
        f"{affordance.id}（{affordance.type.value}）{affordance.label}"
        for affordance in visible_affordances(pack, world)
    ]
    beats_text = _lines([f"{beat['by']} 应当{beat['does']}：{beat['intent']}" for beat in beats], "（无）")

    action_text = "（开场，学生还没做任何事）" if action is None else action.label(pack)
    if action is not None and action.text:
        action_text = f"{action_text}——学生说：「{action.text}」"
    if action is not None and action.custom_text:
        action_text = f"{action_text}——学生自己写的：「{action.custom_text}」"

    turn_block = (
        [
            "# 本回合：开场（第 0 回合）",
            "用 1–2 处感官细节把处境立起来（这里是什么地方、此刻什么在动、什么人是什么状态），",
            "让此刻在场的人按自己的状态开口或保持沉默。学生还没做任何事，等他动手。",
        ]
        if opening or action is None
        else [
            f"# 本回合（第 {world.turn} 回合）",
            f"学生做了：{action_text}",
            "如果他这次是**自由表达**（没点动作按钮），把「他实际做的这件事」对应到「可做动作」里最贴切的那个 id，",
            '写进信封：`"interpretation": {"affordance_id": "那个 id"}`；确实对应不上就写 `{"affordance_id": null}`。',
            "（他点的是动作按钮时，这一条不用管。）",
            "本回合必然发生（已确定的结果，用你自己的语言体现出来）：",
            beats_text,
        ]
    )

    user = "\n".join(
        [
            "# 环境",
            f"情境：{pack.title}｜学生扮演：{pack.player.role}",
            f"地点：{pack.setting.place}｜时间线索：{pack.setting.time_hint}",
            f"处境说明：{pack.one_line}",
            "",
            "## 在场者（各自的知识边界）",
            *_actor_block(pack, world),
            "",
            "## 学生看不到的（真相与尚未揭示的线索，任何在场者都不得直接说出）",
            _lines(pack.truth),
            _lines(pack.hidden_from_player),
            "",
            "## 读数（学生看到的设备面）",
            _device_block(pack, world),
            "",
            "## 可改状态（effects 只能改这些键）",
            _lines([f"{key} = {value}" for key, value in world.state.items()]),
            "",
            "## 已揭示线索（reveals 只能取这些 id；学生已经看到的）",
            _lines([f"{cue_id}：{text}" for cue_id, text in pack.cue_items(world.revealed)]),
            "",
            "## 可做动作（本回合**已解锁**；options 与 interpretation 只能取这里的 id）",
            _lines(available),
            "",
            "## 可用图片（需要让学生看见画面时，用 images 引用这里的 asset_id）",
            _lines([f"{asset.id}｜{asset.title}｜适合：{asset.suggest_when}" for asset in pack.assets]),
            (
                "（本情境允许用 image_request 请求现场生成图片）"
                if pack.image_generation == "allowed"
                else "（本情境不允许现场生成图片：image_request 会被丢弃）"
            ),
            *_tool_block(max_steps),
            *_notes_lines(world),
            "",
            *turn_block,
            "",
            "# 对话记录",
            world.transcript(pack),
        ]
    )

    return [{"role": "system", "content": _SYSTEM}, {"role": "user", "content": user}]


def retry_messages(messages: list[dict[str, str]], hint: str, *, compress: bool = False) -> None:
    """纠偏（就地追加）：截断 → 要求压缩；其他 → 报错误摘要请它修正。

    多步循环是**累积同一段对话**的（工具结果留在上下文里），所以纠偏也走追加，不重建提示词。
    """
    messages.append({"role": "user", "content": f"# 上次输出有问题，请修正\n{hint}"})
    if compress:
        messages.append(
            {
                "role": "user",
                "content": "# 注意\n上次输出被截断。请**压缩**：narration ≤ 60 字，每条台词 ≤ 40 字，options ≤ 3 条，必须完整闭合 JSON。",
            }
        )


def step_messages(messages: list[dict[str, str]], assistant_text: str, tool: str, result: dict[str, object]) -> None:
    """把一次工具来往拼进对话（就地追加）：assistant 说了要调什么，user 返回结果。

    "读工具 → 再决定"就靠这两条消息，不需要供应商侧的 function-calling 协议（流式路径也能跑）。
    """
    messages.append({"role": "assistant", "content": assistant_text})
    messages.append(
        {"role": "user", "content": f"# 工具 {tool} 的结果\n{json.dumps(result, ensure_ascii=False, default=str)}"}
    )


def budget_messages(messages: list[dict[str, str]]) -> None:
    """步数用尽：直接要求产出信封（就地追加）。"""
    messages.append({"role": "user", "content": "# 步数已用尽\n请**直接**输出最终 JSON 信封（不要再调用工具）。"})


def build_entity_messages(
    pack: ScenarioPack,
    world: World,
    actor_id: str,
    intent: str,
) -> list[dict[str, str]]:
    """独立角色实体的提示：它只代言一个人，只输出这一句话。**冻结**（无 pack 使用它，见 docs/21 §三）。"""
    actor = pack.actor(actor_id)
    assert actor is not None  # 由契约校验保证
    own_state = {key.split(".", 1)[1]: value for key, value in world.state.items() if key.startswith(f"{actor.id}.")}
    system = "\n".join(
        [
            f"你就是「{actor.role}」。你不是助手，也不解释自己。",
            f"你的风格：{actor.style or '（未声明）'}",
            f"你的目的：{'、'.join(actor.goals) if actor.goals else '（未声明）'}",
            f"你知道的：{actor.knowledge or '（未声明）'}",
            f"你现在的状态：{own_state or '（未声明）'}",
            "你不知道、也不该知道的：任何你没被告知的事（不得猜测、不得替别人说话）。",
            "只输出你要说的那一句话本身，不要引号、不要旁白、不要 JSON。",
        ]
    )
    user = "\n".join(
        [
            f"处境：{pack.setting.place}｜{pack.one_line}",
            f"此刻你需要回应的意图：{intent}",
            "",
            "刚才发生了什么：",
            world.transcript(pack, limit=8),
        ]
    )
    return [{"role": "system", "content": system}, {"role": "user", "content": user}]
