"""DM 提示装配：把 pack 的声明、世界状态与本回合发生的事交给 DM。

**领域中立**：提示文本只说"情境、在场者、处境、可做的动作"，具体内容全部来自 pack 数据。
"""

from __future__ import annotations

from typing import Any

from ..runtime.world import ActionRecord, World
from ..schema import ScenarioPack

_SYSTEM = """你是这场情境的驱动者（DM）：你不是旁白机器，而是这个世界里所有人的代言者。

职责：
- 让处境按它自身的逻辑继续发展，让每个在场者按**自己的知识与性格**说话、行动或沉默；
- 把学生做的每一件事当作真的发生过——世界要对它做出反应，而不是只等学生提问；
- 决定此刻谁在说话、谁保持沉默、学生能看到什么。

铁律：
1. 「真相」与「各人知道什么」只用于保证世界自洽：学生**看不到**的真相不得被说出或被暗示，
   任何在场者也不得说出自己不该知道的事。
2. 台词必须像那个人说的（符合其风格、情绪与处境），不要写成说明书。
3. 「本回合必然发生」是已经确定的结果，必须体现出来，但要用你的语言，不要照抄意图描述。
4. 只输出 JSON 对象，字段如下（缺项留空，不要输出多余解释）：
   narration       string       学生此刻看到/听到/感觉到的
   lines           [{actor:intent 对应的角色 id, text}]   在场者的话
   facts_declared  [{fact_id?, fact, evidence}]  学生这回合**采集到**的信息（拿不准 id 就只写 fact+evidence）
   effects         [{target, key, op, value}]    只允许改「可改状态」里列出的键
   reveals         [string]                      只允许「已声明线索」里的 id
   ad_hoc_cues     [string]                      你新引入的可见细节（走这里，不要塞进 reveals）
   options         [{label, type, affordance_id?}] 给学生"此刻值得考虑"的动作建议（≤4 条）
5. options 只能取「可用动作」里的 affordance_id，或一条自由发问（type=ask）；**不得**与未揭示的线索同义；
   也**不要**提供"其他/自己输入"这类选项（平台已经有）。
6. 学生一条消息里塞进多个问题时，按真实的人来反应（可以只答一部分、可以反问、可以先愣一下）。
7. **不要重复已经说过的话**：角色没有新内容可说时，可以沉默、用动作或眼神回应，
   而不是把上一轮的台词再抄一遍。
8. 需要让学生**看见画面**时，用 `images` 引用「可用图片」里的 asset_id（配一句 caption），
   不要自己编造 URL 或描述图片文件本身；`image_request` 仅在提示允许时才用。
9. **要有人开口就让他本人开口**：不要用旁白替人说台词。如果此刻该说话的人不在名册里
   （路过的护工、走廊广播、隔壁床、电话另一头），就临时给他一个身份说话：
   `lines` 里写 `{"actor": "任意临时 key", "as_role": "显示名（如 走廊里的护工）", "text": "…"}`。
   临时角色只出现这一次——**不要把名册里的角色临时改成别人**，也**不要**让他承载状态改动。
10. **线索板**（学生只能看、不能改）：要把一条**已确立**的事实钉在板上时用 `notes`：
   `{"text": "≤20 字的结论或订正", "section": "版块 id（可省略）", "supersedes": "要订正的条目 id（可省略）"}`。
   只在"真的确立了一件事"时写；**不要复述旁白、不要写剧情、一条只讲一个新事实**。
   若发现先前记错了，用 `supersedes` 指向那条条目钉正——旧条目会保留但被划掉。

叙事手艺（这一条决定体验好坏）：
- **每回合至少推进一件事**：新信息 / 处境变化 / 关系与情绪变化，三者之一。没有推进就不要写。
- 场景感靠 1–2 处**具体**的感官细节，不堆形容词；不要复述在场者已经知道的事实。
- **呼应前情**：把此前具体发生过的事（谁做过什么、谁说过什么、谁在场）带回来，让世界连贯。
- **让世界有自己的节奏**：处境连续两回合没有变化时，就让它动起来（有人进来、报警、状况变差、
  新的信息浮现、某个在场者主动开口）——不是等学生来问，而是世界先动。
- 用**行动与台词**推进，少解释；不要替学生做决定、不要点评或总结学生的表现，
  不要出现"任务""关卡""提示""选项"这类元话语。

真实感纪律（**口语，但清楚**）：
- 用**日常口语**说话，不要写成记录单或报告；但**信息要说清楚、能被听懂**——
  不要靠含糊、答非所问、故意停顿来制造难度。
- 人不会平均地配合：可以犹豫、反问、抱怨、只顾自己那件事；情绪上来时话会变短，但仍要交代清楚。
- 不要每轮都答同样长度与句式；也不要每个人都是同一种语气。
- 时间用**相对说法**推进（"过了一会儿""这会儿"），不要编造具体分钟数或没发生过的检查结果。
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
                    f"  风格：{actor.style or '（未声明）'}",
                    f"  目的：{'、'.join(actor.goals) if actor.goals else '（未声明）'}",
                    f"  他知道：{actor.knowledge or '（未声明）'}",
                    f"  他当前状态：{own_state or '（未声明）'}",
                ]
            )
        )
    return blocks


def build_dm_messages(
    pack: ScenarioPack,
    world: World,
    action: ActionRecord | None,
    beats: list[dict[str, Any]],
    *,
    problem_hint: str | None = None,
    compress: bool = False,
    opening: bool = False,
) -> list[dict[str, str]]:
    """组装 DM 的 system + user。`problem_hint`/`compress` 用于重试纠偏；`opening` 用于开场回合。"""
    visible_affordances = [
        f"{affordance.id}（{affordance.type.value}）{affordance.label}" for affordance in pack.affordances
    ]
    revealed = [text for _, text in pack.cue_items(world.revealed)] or ["（无）"]
    beats_text = _lines([f"{beat['by']} 应当{beat['does']}：{beat['intent']}" for beat in beats], "（无）")

    action_text = "（开场，学生还没做任何事）" if action is None else action.label(pack)
    if action is not None and action.text:
        action_text = f"{action_text}——学生说：「{action.text}」"
    if action is not None and action.custom_text:
        action_text = f"{action_text}——学生自己写的：「{action.custom_text}」"

    turn_block = (
        [
            "# 开场（第 0 回合）",
            "这是**开场**：用 1–2 处感官细节把处境立起来（这里是什么地方、此刻什么在动、什么人是什么状态），",
            "让此刻在场的人按自己的状态开口或保持沉默。**不要**让学生做选择、**不要**总结任务、**不要**介绍你自己。",
        ]
        if opening or action is None
        else [
            f"# 本回合（第 {world.turn} 回合）",
            f"学生做了：{action_text}",
            "本回合必然发生：",
            beats_text,
        ]
    )

    user = "\n".join(
        [
            f"# 情境\n{pack.title}｜学生扮演：{pack.player.role}",
            f"地点：{pack.setting.place}｜时间线索：{pack.setting.time_hint}",
            f"处境说明：{pack.one_line}",
            "",
            "# 在场者",
            *_actor_block(pack, world),
            "",
            "# 真相（学生不可见，任何在场者都不得直接说出）",
            _lines(pack.truth),
            "",
            "# 学生看不到（未揭示）",
            _lines(pack.hidden_from_player),
            "",
            "# 可改状态（effects 只能改这些键）",
            _lines([f"{key} = {value}" for key, value in world.state.items()]),
            "",
            "# 已声明线索（reveals 只能取这些 id）",
            _lines([f"{cue_id}：{text}" for cue_id, text in pack.cue_items(world.revealed)]),
            f"（学生目前看到：{_lines(revealed)}）",
            "",
            "# 可用动作（options 只能取这些 id，或 type=ask 的自由发问）",
            _lines(visible_affordances),
            "",
            "# 可用图片（需要让学生看见画面时，用 images 引用这里的 asset_id，并给一句 caption）",
            _lines([f"{asset.id}｜{asset.title}｜适合：{asset.suggest_when}" for asset in pack.assets]),
            (
                "（本情境允许用 image_request 请求现场生成图片）"
                if pack.image_generation == "allowed"
                else "（本情境不允许现场生成图片：image_request 会被丢弃）"
            ),
            "",
            *turn_block,
            "",
            "# 对话记录",
            world.transcript(pack),
        ]
    )

    if problem_hint:
        user += f"\n\n# 上次输出有问题，请修正\n{problem_hint}"
    if compress:
        user += "\n\n# 注意\n上次输出被截断。请**压缩**：narration ≤ 60 字，每条台词 ≤ 40 字，options ≤ 3 条，必须完整闭合 JSON。"

    return [{"role": "system", "content": _SYSTEM}, {"role": "user", "content": user}]


def build_entity_messages(
    pack: ScenarioPack,
    world: World,
    actor_id: str,
    intent: str,
) -> list[dict[str, str]]:
    """独立角色实体的提示：它只代言一个人，只输出这一句话。"""
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
