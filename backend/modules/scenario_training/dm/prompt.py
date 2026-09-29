"""两个模型阶段的提示装配（**领域中立**：内容全部来自 pack 数据）。

- `build_intent_messages`：解析学生的一次表达 → `IntentResolution`（可以看动作约束与隐藏依据）；
- `build_delivery_messages`：把**已经结算完**的处境演出来 → `SceneDelivery`（看不到隐藏真相、
  也看不到未揭示线索的文本；没有写权限）。

两个阶段共用同一套角色与世界契约，只是**输入权限不同**（docs/23 §4.1/§4.4）。
JSON 形状一律由 `dm.contract.schema_of` 从 pydantic 模型生成，不在提示词里另写一份规范。
"""

from __future__ import annotations

from collections.abc import Sequence

from ..runtime.devices import build_devices
from ..runtime.world import World, contactable_actor, visible_affordances
from ..schema import ScenarioPack
from ..turns import IntentResolution, ResolvedTurn, SceneDelivery
from .contract import banned_terms, schema_of

_INTENT_SYSTEM = """你是这场情境的**意图解析器**。你只做一件事：把学生这一次表达，说成一件**可被世界结算**的事。

你不写台词、不写旁白、不改世界、不点评学生；你的输出只被平台用来决定「他到底想做什么」。

# 硬规则
0. **时间不归你管**：说话、观察、测量都不消耗时间；花多少时间由平台按包声明的 `time_cost` 结算。
   你只负责把学生这次表达归属成一个可结算的意图（或澄清），不要替他"花时间"、也不要在输出里改时间。
1. **通道优先**：学生已经声明的通道决定了性质——「说话」通道里的话是**交流**，「行动」通道里的话是**尝试做一件事**。
   说话永远不等于「已经完成了一次物理处置」；只有叫人来、问话这一类**言语动作**可以被归属。
2. **没有发生的事不能算发生**：「准备做」「是不是应该做」「如果做会怎样」「待会儿要不要」都不是已执行。
   这类表达要么是说话（发问/自述），要么是需要澄清——不能填 `affordance_id` 当成一次执行。
3. **学生已经选定就照抄**：动作 id、目标、选项都由学生给出时，逐字采用，不要改写、不要加料、不要换更"合适"的。
4. **目标必须来自「可达对象」一节，逐字**：`{"kind","id"}` 两个字段都要对。动作绑定了多个目标而学生没说清对象时，
   用 `kind="clarification"` 问清楚——**不要**靠最近聊天对象暗中补全。
5. **对不上任何已声明动作**，就把 `affordance_id` 留空（平台会记为"未建模的尝试"并诚实说明）。
   不要"找一个最接近的动作"让它成功。
6. **一次只结算一件**：学生一口气列出多个互相依赖的操作时，不要全部算完成——用 clarification 让他选定**先尝试哪一个**。
   普通复合台词（一句话里同时有寒暄和问题）不需要拆。
7. `selection` 只能取该动作 `options` 里的 id；拿不准就留空。
8. `social_updates` 只能取「人物状态」一节逐字列出的**全限定键**（形如 `patient.comfort`，原样照抄，
   不要简写成 `comfort`），且必须由**本次交流内容**支撑；「同意配合」不等于「已经完成操作」。
   没有依据就不写；写错键名会被平台拒绝并记账（等于白写）。
9. `clarification` 只问**一句**具体的话（问对象、问参数），不含答案提示、不暗示最优路线、不出现下面列出的禁用词。
10. `utterance` 是**学生原话**（照抄，不是转述）。

# 输出
只输出一个 JSON 对象，形状严格如下（多余字段会被平台丢弃）：
«SCHEMA»"""

_DELIVERY_SYSTEM = """你是这场情境的主持人。处境**已经结算完了**——你的工作只是把它自然呈现出来。

你**没有**改世界的权限：不能写状态、不能新造读数或检查结果、不能让某件事"显得"成功、不能替学生做判断。

# 硬规则
1. **只说已经发生的**：素材只有「本回合已经发生的可见事件」与「各角色允许知道的信息」。
   未揭示的线索、别人的隐私、还没做的检查、隐藏结论——一律不得出现，也不得暗示。
2. **谁开口就让谁自己说**：旁白用 `speaker: null`；台词 `speaker` 用「在场者」一节逐字给出的角色 id。
   此刻要说话的人不在名册里（路过的同事、走廊广播、电话那头），用临时身份：`speaker` 给一个临时 key + `as_role` 给显示名。
   临时身份只在本回合有效，不承载任何状态。
3. **临场细节可以写，但不能升级**：语气、表情、环境、犹豫、沉默都可以；不能因此变成病情结论、设备读数、
   动作成功或判读依据。
4. **被阻止 / 未建模要诚实**：已经给你的说明要自然带进场景，不要替学生绕过或换个说法让它看起来做成了；
   也不要复述平台口吻（"平台无法模拟"之类留给引擎直出的那条）。
5. **不替学生**：不替他识别风险、不替他完成操作、不给出标准答案式的结论；不点评、不总结他的表现；
   不出现「任务」「关卡」「提示」「选项」这类元话语。
6. **多对象可以同时有诉求**：不要替学生排优先级，不要因为他在处理一件事就让另一件事消失。
7. `sources` 只能引用「可见事件」一节里逐字给出的 ref；`assets` 只能引用「可用资源」一节逐字给出的 id；
   `highlights` 只能引用可见事件里的 ref。拿不准就留空。
8. 时间用**相对说法**推进（"过了一会儿""这会儿"），不要编造具体分钟数。
9. 篇幅克制：一般 1–4 条消息，具体、能读；不要每轮都同样的句式；不要复述已经说过的话。
10. **时间由包声明决定，不归你管**：说话、观察、测量**不消耗时间**（信息获取理所当然）。
    本回合消耗的时间单位会明确告诉你（0 = 没有花时间）——**0 时不得描写时间流逝**（不许写"过了一会儿"
    "几分钟后""半小时后"这类字样）；大于 0 时才可以自然地让时间往前走一点，**幅度与它相称**。
11. **输出不得为空**：`messages` 与 `hints` 至少有一个非空；写了不在「可见事件」里的 ref、
    或让未获准的短语出现，**整条输出会被作废**并要求你重来（平台不会替你删掉再照说）。

# 输出
只输出一个 JSON 对象，形状严格如下：
«SCHEMA»"""

_OPENING_SYSTEM = """你是这场情境的主持人。现在是**开场**：还没有发生任何学生动作。

把处境立起来——学生此刻在哪、眼前是什么、谁在场、气氛如何——然后**停下来等学生动手**。

# 硬规则
1. 只依据「此刻的处境」与「在场者允许知道的信息」；未揭示的线索、隐藏结论一律不得出现或暗示。
2. 谁开口就让谁自己说（`speaker` 用「在场者」里逐字给出的 id；要临时角色就给 `as_role` 显示名）。
3. 给全学生**判断所需的现场信息**，但不给任务清单、不排优先级、不提示下一步、不点评。
4. 不出现「任务」「关卡」「提示」「选项」这类元话语；不要编造读数或检查结果；不要描写时间流逝。
5. `sources` 只能引用「可见事件」一节里的 ref；`assets` 只能引用「可用资源」一节里的 id；拿不准就留空。
6. **输出不得为空**（`messages` 至少一条）。

# 输出
只输出一个 JSON 对象，形状严格如下：
«SCHEMA»"""

_HINT_SYSTEM = """学生**主动请求了一次提示**。这是一次教学交互：给方向，不给答案；不涉及世界推进。

# 硬规则
1. **只给方向，不给条目**：指引他"去看什么 / 想到哪一层"，**不要**替他说出具体处置、不要列出正确步骤。
2. **不许揭开还没获得的东西**：未揭示的线索、隐藏结论、别人的隐私、还没做的检查结果都不能出现，
   也不能用"你也许该想想……"这种暗示把它带出来。做不到在不泄底的前提下给方向，就直说"这一处我只能提示到方向"。
3. 一两句短话；可以用一个在场者的一句话，也可以用旁白。
4. 不点评学生此前表现，不出现「任务」「关卡」「答案」这类元话语；也不要描写时间流逝（提示不消耗时间）。
5. `sources` / `assets` / `highlights` 的引用规则与平常一样；拿不准就留空。
6. **输出不得为空**；出现未获准的短语会让整条作废并让你重来一次。

# 输出
只输出一个 JSON 对象，形状严格如下：
«SCHEMA»"""


def _lines(values: Sequence[str], empty: str = "（无）") -> str:
    return "\n".join(f"- {value}" for value in values) if values else empty


def _target_block(pack: ScenarioPack, world: World) -> list[str]:
    out = ["", "## 可达对象（`target` 只能逐字取这里的 kind+id）"]
    for actor in pack.actors:
        reach = "可达" if contactable_actor(pack, actor.id) else "**不可达（看得见，碰不着）**"
        out.append(
            f"- actor/{actor.id}｜{actor.role}｜在场方式 {actor.presence.value}｜{reach}"
            f"｜索取注意力的方式 {actor.demand.value}"
        )
    for device in pack.presentation.devices:
        out.append(f"- device/{device.id}｜{device.title}（{device.kind}）")
    out.append("- scene/scene｜整个处境（全场级动作、对所有人说话）")
    return out


def _affordance_block(pack: ScenarioPack, world: World) -> list[str]:
    rows: list[str] = []
    for affordance in visible_affordances(pack, world):
        targets = "、".join(f"{item.kind.value}/{item.id}" for item in affordance.targets) or "（不限）"
        params = affordance.params or {}
        options = params.get("options") or []
        detail = ""
        if options:
            detail = "｜选项：" + "、".join(f"{option.get('id')}" for option in options)
        elif params.get("fields"):
            detail = "｜记录字段：" + "、".join(str(field) for field in params["fields"])
        rows.append(f"- {affordance.id}（{affordance.type.value}｜{affordance.label}）｜可作用对象：{targets}{detail}")
    return ["", "## 此刻可用的动作（`affordance_id` 只能取这里的 id）", _lines(rows)]


def _visible_state(pack: ScenarioPack, world: World) -> str:
    rows = [
        f"{channel.label} {channel.display}{channel.unit}（{channel.status}）"
        for device in build_devices(pack, world)
        for channel in device.channels
    ]
    for section in pack.presentation.board:
        for ref in section.refs:
            if ref in world.state:
                rows.append(f"{section.label_for(ref)} {world.state[ref]}")
    return _lines(sorted(set(rows)))


def _cue_block(pack: ScenarioPack, world: World) -> list[str]:
    """演出/解析都只拿到**已揭示**线索的文本；未揭示的线条一个字都不给（防泄底）。"""
    return [
        "",
        "## 已揭示线索（学生已经看到的）",
        _lines([f"{cue_id}：{text}" for cue_id, text in pack.cue_items(world.revealed)]),
        "",
        "## 学生已经注意到的现场细节",
        _lines(list(world.ad_hoc_cues)),
    ]


def _social_block(pack: ScenarioPack) -> list[str]:
    rows: list[str] = []
    for actor in pack.actors:
        for item in actor.dm_writable:
            key = item.key if "." in item.key else f"{actor.id}.{item.key}"
            bound = f"，取值 {item.lo}–{item.hi}" if item.lo is not None or item.hi is not None else ""
            delta = f"，单次最多变 {item.max_delta}" if item.max_delta is not None else ""
            rows.append(f"- {key}（{item.kind}{bound}{delta}）：{item.meaning}")
    if not rows:
        return ["", "## 人物状态（可写）", "本包没有 DM 可写的人物状态：`social_updates` 一律留空。"]
    return [
        "",
        "## 人物状态（可写；`social_updates[].key` **只能逐字照抄全限定键**，不要简写）",
        _lines(rows),
    ]


def _focus_block(pack: ScenarioPack, world: World, *, for_hint: bool = False) -> list[str]:
    """教学关注点只给**意图**与相关性；不告诉 DM「该让学生完成什么」，也没有推进权。"""
    rows: list[str] = []
    for item in pack.teaching_focus:
        from ..runtime.world import trigger_holds

        relevant = item.relevant_when is None or trigger_holds(pack, world, item.relevant_when)
        if not relevant:
            continue
        addressed = item.addressed_when is not None and trigger_holds(pack, world, item.addressed_when)
        rows.append(f"- {item.id}｜{item.intent}｜{'已有处理证据' if addressed else '还没有处理证据'}")
    if not rows:
        return []
    head = "## 相关教学关注点（只给你看；**不要直接讲出来**，也不要为了它推进世界）"
    tail = "（学生主动求助时才可作为给方向时的参考。）" if for_hint else "（只影响你把哪一处呈现得更清楚。）"
    return ["", head, _lines(rows), tail]


def _transcript(world: World, pack: ScenarioPack, limit: int = 12) -> list[str]:
    return ["", "## 近期经历（按回合时序）", world.transcript(pack, limit=limit) or "（还没有）"]


def build_intent_messages(
    pack: ScenarioPack,
    world: World,
    *,
    mode: str,
    text: str,
    target: dict | None = None,
    affordance_id: str | None = None,
    selection: list[str] | None = None,
) -> list[dict[str, str]]:
    """解析阶段的提示：`mode` = 学生声明的通道（speech / action）。"""
    system = _INTENT_SYSTEM.replace("«SCHEMA»", schema_of(IntentResolution))
    declared = []
    if affordance_id:
        declared.append(f"他已选定的动作 id：{affordance_id}")
    if target:
        declared.append(f"他已选定的对象：{target.get('kind')}/{target.get('id')}")
    if selection:
        declared.append(f"他已选定的选项：{'、'.join(selection)}")
    facts = [
        "",
        "# 场景",
        f"- 学生扮演：{pack.player.role}",
        f"- 地点：{pack.setting.place}" + (f"（{pack.setting.time_hint}）" if pack.setting.time_hint else ""),
        "",
        "# 学生这一次表达",
        f"- 他声明的通道：{'说话' if mode == 'speech' else '行动（尝试做一件事）'}",
        f"- 他的原话：「{text}」" if text else "- 他的原话：（没有文字，只是一次选择）",
        *(["- 平台已记录的选择：" + "；".join(declared)] if declared else []),
        "",
        "# 此刻的处境（学生可见）",
        _visible_state(pack, world),
        *_cue_block(pack, world),
        *_transcript(world, pack),
        *_affordance_block(pack, world),
        *_target_block(pack, world),
        *_social_block(pack),
        "",
        "# 隐藏依据（**只用于正确归属，绝不可出现在输出里**）",
        _lines(list(pack.truth)),
        "",
        "# 禁用词（出现在 clarification 里会被判为不合格）",
        _lines(banned_terms(pack, world)),
    ]
    return [{"role": "system", "content": system}, {"role": "user", "content": "\n".join(facts)}]


def build_delivery_messages(
    pack: ScenarioPack,
    world: World,
    *,
    request_text: str,
    request_mode: str,
    target: dict | None,
    resolved: ResolvedTurn,
    notice: str = "",
    mode: str = "turn",
) -> list[dict[str, str]]:
    """演出阶段的提示：**没有** truth、没有未揭示线索、没有可写状态。"""
    if mode == "hint":
        system = _HINT_SYSTEM.replace("«SCHEMA»", schema_of(SceneDelivery))
    elif mode == "opening":
        system = _OPENING_SYSTEM.replace("«SCHEMA»", schema_of(SceneDelivery))
    else:
        system = _DELIVERY_SYSTEM.replace("«SCHEMA»", schema_of(SceneDelivery))

    actor_rows = [
        f"- {actor.id}｜{actor.role}（在场方式 {actor.presence.value}，索取注意力的方式 {actor.demand.value}）"
        f"｜风格：{actor.style or '（未声明）'}"
        f"｜此刻想要：{'、'.join(actor.goals) if actor.goals else '（未声明）'}"
        f"｜在场者本人知道的：{actor.knowledge or '（未声明）'}"
        for actor in pack.actors
    ]
    visible_rows = [f"- [{event.ref or event.kind}]（{event.kind}）{event.text}" for event in resolved.visible_events]
    assets = [f"- {asset.id}｜{asset.title or asset.alt}" for asset in pack.assets]
    body = [
        "",
        "# 场景",
        f"- 学生扮演：{pack.player.role}",
        f"- 地点：{pack.setting.place}" + (f"（{pack.setting.time_hint}）" if pack.setting.time_hint else ""),
        "",
        "# 在场者（只有这里的 id 可以直接当 `speaker`）",
        _lines(actor_rows),
        "",
        *(
            [
                "# 学生这一次做了什么",
                f"- 通道：{'说话' if request_mode == 'speech' else '行动'}",
                f"- 原话：「{request_text}」" if request_text else "- 原话：（他只是点了一个动作）",
                *([f"- 他指定的对象：{target.get('kind')}/{target.get('id')}"] if target else []),
                f"- 动作：{resolved.action.label or '（未建模的尝试）'}",
                f"- 世界的答复：{resolved.outcome.value}"
                + (f"（{resolved.block_reason}）" if resolved.block_reason else ""),
                f"- 本回合消耗的时间单位：{resolved.time_cost}"
                + ("" if resolved.time_cost else "（**0 = 没有花时间：禁止描写时间流逝**）"),
                f"- 发生时的时间单位累计值：{resolved.turn}",
                *(
                    [f"- 引擎已经直出的说明（你要自然地把它带进场景，不要复述平台口吻）：「{notice}」"]
                    if notice
                    else []
                ),
            ]
            if mode != "opening"
            else ["# 开场（还没有学生动作）", "- 立起处境，让在场者按自己的处境开口，然后把话筒交给学生。"]
        ),
        "",
        "# 本回合已经发生的可见事件（你只能写这些）",
        _lines(visible_rows),
        "",
        "# 此刻的处境（学生可见）",
        _visible_state(pack, world),
        *_cue_block(pack, world),
        *_transcript(world, pack),
        *_focus_block(pack, world, for_hint=(mode == "hint")),
        "",
        "# 可用资源（`assets` 只能取这里的 id）",
        _lines(assets),
        "",
        "# 禁用词（不得出现在任何消息里）",
        _lines(banned_terms(pack, world)),
    ]
    return [{"role": "system", "content": system}, {"role": "user", "content": "\n".join(body)}]


def retry_messages(messages: list[dict[str, str]], problem: str) -> None:
    """纠偏：把该阶段的错误就地追加给模型（错误反馈**限定在该阶段**）。"""
    messages.append(
        {
            "role": "user",
            "content": f"上一次输出不可用：{problem}\n请只按给定 JSON 形状重新输出一次，不要解释、不要加字段。",
        }
    )
