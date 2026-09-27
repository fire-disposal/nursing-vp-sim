"""情境训练 · DM（Dungeon Master）输出契约与校验。

**DM 的地位**：DM 是世界观与场景的驱动者——它决定此刻发生什么、谁说话、世界怎么变，
并向学生**提议**可做的事。平台不替它表演，只做三件事：**校验 → 应用 → 记录**。
DM 有想象力，但改动必须声明式。

**工具层领域中立**（docs/20 §六）：本文件不出现任何领域（医疗）概念——
动作类型是中立的动词（问/看/量/做/记/叫），状态键、线索、事实、决策点**全部由 pack 声明**。

三条硬规则：
1. `options` 只能来自 pack 的 affordances（或自由发问），**绝不能来自 facts 的条目**；
2. **要判读**的世界改动必须使用 pack 已登记的状态键；不判读的世界细节由 DM 自由叙述；
3. DM 不得发明与 pack 冲突的事实；冲突以 pack 为准，即兴内容**标记来源**（`ad_hoc_cues`）。

预留（2026-09-27）：`delegate` —— DM 可把某个 **`entity="dedicated"`** 角色的台词交给
独立 LLM 实体产出（purpose `st_patient`）；DM 仍是决定"何时让它说、意图是什么"的一方，
实体的输出**不能改状态**，全部状态改动仍走 DM 声明的 `effects`。
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from infra.llm import safe_parse_json
from infra.llm.parsing import TruncatedJSONError

from ..runtime.anchors import AnchorReport, AnchorStatus
from ..runtime.world import World, facts_observed, visible_affordances
from ..schema import AffordanceType, Effect, ScenarioPack
from .tools import TOOL_NAMES

# DM 不得提供的自由输入占位（平台保证存在，见 docs/20 §九）
_FREE_INPUT_LABELS = ("其他", "其它", "自输入", "自定义", "自己输入", "other", "type your own")


class TurnParseError(ValueError):
    """DM 输出不是可用 JSON。"""


class TurnTruncatedError(TurnParseError):
    """DM 输出被截断——应压缩输出后重试，而不是原样重试。"""


class DMLine(BaseModel):
    """一句台词。说话人可以是**已声明角色**，也可以是 DM 临时拉出的**现场角色**。

    临时角色（`as_role` 非空且 `actor` 不在名册里）只出现这一次：它有显示名与气泡，
    但不进在场者名册、不能承载状态改动——世界之声需要一个人开口时，用这个，而不是用旁白替人说话。
    """

    model_config = ConfigDict(extra="ignore")

    actor: str  # 已声明角色 id；临时角色用任意 key
    text: str
    as_role: str = ""  # 临时角色的显示名（actor 不在名册时必填）
    ephemeral: bool = False  # 仅这一次出现
    origin: Literal["dm", "entity"] = "dm"  # 谁产出的这句话（预留独立实体）


class DMDelegate(BaseModel):
    """DM 请求把某角色的台词交给独立实体产出。"""

    model_config = ConfigDict(extra="ignore")

    actor: str
    intent: str


class DMFact(BaseModel):
    model_config = ConfigDict(extra="ignore")

    fact: str
    fact_id: str | None = None
    evidence: str = ""


class DMOption(BaseModel):
    model_config = ConfigDict(extra="ignore")

    label: str
    type: AffordanceType
    affordance_id: str | None = None
    params: dict[str, Any] = Field(default_factory=dict)


class DMImage(BaseModel):
    """DM 展示一张**场景资源包内**的预定义图片（只能引用 pack 声明过的 id）。"""

    model_config = ConfigDict(extra="ignore")

    asset_id: str
    caption: str = ""


class DMImageRequest(BaseModel):
    """预留：DM 请求**绘画者 AI** 现场生成一张图（需 pack 显式允许）。"""

    model_config = ConfigDict(extra="ignore")

    prompt: str
    caption: str = ""


class DMNote(BaseModel):
    """DM 写在白板上的一条**简短**判断（也可订正已有条目）。"""

    model_config = ConfigDict(extra="ignore")

    text: str
    section: str = ""  # 目标版块 id；空 = 落进第一个 note 版块
    supersedes: str = ""  # 订正某条已有条目（旧条目保留并标记被取代）


class DMInterpretation(BaseModel):
    """DM 对**学生这句话**的解读：它等价于哪一个**已声明**的 affordance。

    只在学生**自由表达**（没点按钮）时才有意义——学生点了按钮，一切以他选的为准。
    映射不出就留空：宁缺毋假，绝不硬凑一个归属。
    """

    model_config = ConfigDict(extra="ignore")

    affordance_id: str | None = None


class DMAnchorBlock(BaseModel):
    """DM 提议某个锚点**被卡住**：缺哪一步（`reason` 是它自己的说法，引擎只认重算的状态）。

    字段缺失按空处理（与 `DMTurn` 同一口径）：坏提案由裁决层拒绝并纠偏，不在这里抛。
    """

    model_config = ConfigDict(extra="ignore")

    id: str = ""
    reason: str = ""


class DMToolCall(BaseModel):
    """DM 在产出信封**之前**的一次环境读取（多步循环，见 docs/21 §四）。"""

    model_config = ConfigDict(extra="ignore")

    tool: str
    args: dict[str, Any] = Field(default_factory=dict)


class DMTurn(BaseModel):
    """DM 单回合输出。字段缺失一律按空处理，不抛。"""

    model_config = ConfigDict(extra="ignore")

    narration: str = ""
    lines: list[DMLine] = Field(default_factory=list)
    interpretation: DMInterpretation | None = None  # 把学生的自由表达映射到已解锁的 affordance
    delegate: list[DMDelegate] = Field(default_factory=list)
    facts_declared: list[DMFact] = Field(default_factory=list)
    notes: list[DMNote] = Field(default_factory=list)  # 写在线索板上的判断/订正（简短）
    effects: list[Effect] = Field(default_factory=list)
    reveals: list[str] = Field(default_factory=list)
    ad_hoc_cues: list[str] = Field(default_factory=list)  # DM 即兴的可见线索（标记来源）
    options: list[DMOption] = Field(default_factory=list)
    images: list[DMImage] = Field(default_factory=list)  # 展示 pack 内的预定义图片
    image_request: DMImageRequest | None = None  # 预留：请求绘画者 AI 生成（需 pack 允许）
    # 叙事锚点：DM 只能**提议**（docs/21 §4.0）——引擎只采纳与重算一致者，其余丢弃并纠偏
    anchor_satisfied: str = ""  # 提议"这个锚点已达成的 id"
    anchor_blocked: DMAnchorBlock | None = None  # 提议"这个锚点被卡住（含原因）"


class TurnCheck(BaseModel):
    """校验结果：清洗后的回合 + 问题清单 + 丢弃计数。"""

    model_config = ConfigDict(extra="forbid")

    turn: DMTurn
    problems: list[str] = Field(default_factory=list)
    dropped: dict[str, int] = Field(default_factory=dict)

    @property
    def ok(self) -> bool:
        return not self.problems


def parse_turn(raw: str) -> DMTurn:
    """解析 DM 输出为 DMTurn。底层复用 infra 的 JSON 解析（唯一实现）。"""
    try:
        return DMTurn.model_validate(safe_parse_json(raw))
    except TruncatedJSONError as exc:
        raise TurnTruncatedError(str(exc)) from exc
    except (ValueError, TypeError) as exc:
        raise TurnParseError(str(exc)) from exc


#: 信封字段名（= `DMTurn` 的全部字段）：带其中任何一个都按**信封**处理，不认成工具调用
ENVELOPE_KEYS = frozenset(DMTurn.model_fields)

#: `<thinking>` 段（与 infra 的 `safe_parse_json` 同一口径：思考里的话不算输出）
_THINKING_BLOCK = re.compile(r"<thinking>[\s\S]*?</thinking>", flags=re.IGNORECASE)
#: 零宽字符：JSON 不允许、人眼看不见（"看起来完全正确"的解析失败元凶之一）
_INVISIBLE = "\u200b\u200c\u200d\u2060\ufeff"
#: 全角**结构**标点 + 全角/不换行空格：只在字符串**外**规整（字符串里那是正文标点，一字不改）
_DECORATIONS = str.maketrans(
    {"，": ",", "：": ":", "｛": "{", "｝": "}", "［": "[", "］": "]", "　": " ", "\u00a0": " "}
)
#: 弯引号：只在字符串**外**出现时按 JSON 的 `"` 处理
_QUOTES = "\u201c\u201d\u201e"
_SNIPPET_LIMIT = 120


def _snippet(text: str) -> str:
    """问题串里的原文片段：压成单行并截断——排查时要能看到模型**到底发了什么**。"""
    return " ".join(text.split())[:_SNIPPET_LIMIT]


def _next_meaningful(text: str, index: int) -> str:
    """`index` 之后第一个非空白字符；没有就返回空串。"""
    cursor = index + 1
    while cursor < len(text) and text[cursor] in " \t\r\n":
        cursor += 1
    return text[cursor] if cursor < len(text) else ""


def _normalize_decorations(text: str) -> str:
    """把"看着像 JSON、机器读不了"的装饰字符规整成 JSON（字符串内容与转义一字不动）。

    只做三件**不改变语义**的事：去零宽字符、字符串外换全角结构标点/全角空格、丢掉字符串外的尾随逗号。
    字符串内部绝不替换——中文正文里 `，`/`：` 是真标点，改它就是改内容。
    因此对**本来就合法**的 JSON 它是恒等变换（合法 JSON 的字符串外不会出现这些东西）。
    """
    out: list[str] = []
    quote = ""  # 当前字符串的定界引号；空 = 不在字符串里
    index = 0
    while index < len(text):
        char = text[index]
        if quote:
            if char == "\\" and index + 1 < len(text):
                out.append(text[index : index + 2])
                index += 2
                continue
            if char == quote or (quote != '"' and char in _QUOTES):
                out.append('"')
                quote = ""
            else:
                out.append(char)
            index += 1
            continue
        if char in _INVISIBLE:
            index += 1
            continue
        if char == '"' or char in _QUOTES:
            quote = char
            out.append('"')
        elif char == "," and _next_meaningful(text, index) in "}]":
            pass  # 尾随逗号：字符串外，丢掉（JSON 不允许，语义上什么都没少）
        else:
            out.append(char.translate(_DECORATIONS))
        index += 1
    return "".join(out)


def _decode_objects(text: str) -> list[tuple[dict[str, Any], str]]:
    """按出现顺序取出全部 JSON 对象，连同各自的原文（用 `json.raw_decode` 定界，不猜括号）。

    逐个 `{` 试解：成功就收下并**从对象末尾继续**（对象里的嵌套对象因此不会被重复收），
    失败就往后挪一个字符再试（于是"前面一段散文里带花括号"不会毒死整段）。
    """
    found: list[tuple[dict[str, Any], str]] = []
    decoder = json.JSONDecoder()
    index = 0
    while index < len(text):
        start = text.find("{", index)
        if start == -1:
            break
        try:
            value, end = decoder.raw_decode(text, start)
        except json.JSONDecodeError:
            index = start + 1
            continue
        if isinstance(value, dict):
            found.append((value, text[start:end]))
        index = end
    return found


def _json_objects(raw: str) -> list[tuple[dict[str, Any], str]]:
    """一次响应里的全部 JSON 对象（先按原文扫；文本需要规整时，以规整过的为准）。

    为什么"规整优先"而不是"原文优先"：夹着全角冒号的 `{"tool"： "world.state", "args": {}}`
    在原文里能从 `"args": {` 抠出一个孤零零的 `{}`（看着像"扫到了东西"），
    于是原文扫描的**非空结果**会把本来正确的规整结果挡在外面——这类串正是被整段判死的。
    """
    body = _THINKING_BLOCK.sub("", raw)
    normalized = _normalize_decorations(body)
    if normalized != body:
        found = _decode_objects(normalized)
        if found:
            return found
    return _decode_objects(body)


def _tool_name(value: Any) -> str | None:
    """工具名规整：去空白，并容忍提示词里带括号的签名写法（`world.state()` = `world.state`）。"""
    if not isinstance(value, str):
        return None
    name = value.strip()
    if name.endswith("()"):
        name = name[:-2].strip()
    return name or None


def _as_call(data: dict[str, Any]) -> DMToolCall | str:
    """把一条"要工具"的对象变成调用；不合法就返回**原因**（严格校验都在这里）。

    `args` 缺省或 `null` 按**空参**处理（读工具本就无参）；给了别的东西（字符串/数组/数字）是
    形状错——**不能**默默当成空参执行，那等于替模型猜它想读什么。
    """
    name = _tool_name(data.get("tool"))
    if name is None:
        return "bad_tool_name"
    if name not in TOOL_NAMES:
        return f"unknown_tool:{name}"
    args = data.get("args")
    if args is not None and not isinstance(args, dict):
        return f"bad_args:{type(args).__name__}"
    return DMToolCall(tool=name, args=args or {})


@dataclass(frozen=True)
class StepBatch:
    """一次响应里的工具调用判定：**有序**的可执行调用 + 被拒的那条（原因 + 问题串）。

    三条出路互斥：`calls` 非空 = 按顺序执行；`rejection` 非空 = 看着像调用但不合法（不执行，
    `problem` 是一条带原文片段的问题串）；都空 = 这段输出不是工具调用（交给信封解析）。
    """

    calls: tuple[DMToolCall, ...] = ()
    rejection: str | None = None  # 短原因（纠偏话术用它告诉模型错在哪）
    problem: str | None = None  # 事件/排查里的问题串：`dm_step_invalid:<原因>:<原文片段>`

    @property
    def is_step(self) -> bool:
        """这段输出算不算"要工具"（被拒也算）——是的话就不再按信封解析。"""
        return bool(self.calls) or self.rejection is not None


def parse_steps(raw: str) -> StepBatch:
    """把一段输出解析成**一批**工具调用 `{"tool": ..., "args": {...}}`（按输出顺序）。

    实测（2026-09-28 线上 06:35:33 的 `llm_call_logs.response_text`，逐字）：
    ```
    {"tool": "world.state", "args": {}}
    {"tool": "actor.knowledge", "args": {"who": "patient"}}
    {"tool": "history.lastN", "args": {"n": 6}}
    ```
    模型在**一次响应**里发了三条调用（一行一个对象）——一口气把想读的都读掉是自然的 agent 行为。
    旧实现只认"整段就是一个对象"（`safe_parse_json` 从第一个 `{` 切到最后一个 `}`），三条被切成一段
    `Extra data`，于是整个回合降级成保底。

    宽容解析（围栏、前后散文、对象之间还有别的对象、全角/零宽装饰字符、缺 `args`），
    严格校验（工具名必须在 `TOOL_NAMES` 里、`args` 必须是对象）：不合法的那条**不进 `calls`**，
    而是作为 `rejection` 留给排查与纠偏——绝不静默当成"没看懂"。
    """
    objects = _json_objects(raw)
    if any(ENVELOPE_KEYS & obj.keys() for obj, _text in objects):
        return StepBatch()  # 出现任何信封字段（含半成品信封）一律按信封处理，不执行工具
    calls: list[DMToolCall] = []
    rejection: str | None = None
    problem: str | None = None
    for data, text in objects:
        if "tool" not in data:
            continue  # 没有 `tool` 键的对象不是在要工具（也不算错）
        outcome = _as_call(data)
        if isinstance(outcome, DMToolCall):
            calls.append(outcome)
        elif rejection is None:
            # 只留**第一条**被拒的（一批里错法一样，重复记没意义）；原文片段带上，排查才有据
            rejection, problem = outcome, f"dm_step_invalid:{outcome}:{_snippet(text)}"
    return StepBatch(calls=tuple(calls), rejection=rejection, problem=problem)


def _bump(dropped: dict[str, int], key: str) -> None:
    dropped[key] = dropped.get(key, 0) + 1


def banned_terms(pack: ScenarioPack, world: World | None = None) -> list[str]:
    """按钮/选项文案里不得出现的术语：由 facts 派生（作者可用 banned_phrases 显式补充）。

    已经**揭示**的事实不再算泄底——否则 DM 一旦让学生看见某条线索，就再也不能谈论它。
    """
    observed = facts_observed(pack, world) if world is not None else set()
    terms: list[str] = []
    for fact in pack.facts:
        if fact.id in observed:
            continue
        for token in re.split(r"[^\w\u4e00-\u9fff]+", f"{fact.id} {fact.intent}"):
            if len(token) >= 2:
                terms.append(token)
        terms.extend(fact.banned_phrases)
    return sorted(set(terms))


def _clean_lines(pack: ScenarioPack, turn: DMTurn, problems: list[str], dropped: dict[str, int]) -> list[DMLine]:
    """说话人要么是已声明角色，要么是**临时角色**（必须给显示名；无名即丢弃）。"""
    actor_ids = {actor.id for actor in pack.actors}
    kept: list[DMLine] = []
    for line in turn.lines:
        if line.actor in actor_ids:
            kept.append(line.model_copy(update={"ephemeral": False}))
            continue
        role = line.as_role.strip()
        if not role or not line.text.strip():
            problems.append(f"unknown_actor:{line.actor}")
            _bump(dropped, "lines")
            continue
        kept.append(line.model_copy(update={"as_role": role, "ephemeral": True}))
    return kept


def _clean_delegate(pack: ScenarioPack, turn: DMTurn, problems: list[str], dropped: dict[str, int]) -> list[DMDelegate]:
    """委托只允许交给 `entity="dedicated"` 的角色（预留能力的边界）。"""
    actor_ids = {actor.id for actor in pack.actors}
    dedicated = {actor.id for actor in pack.actors if actor.entity == "dedicated"}
    kept: list[DMDelegate] = []
    for item in turn.delegate:
        if item.actor not in actor_ids:
            problems.append(f"unknown_actor:{item.actor}")
            _bump(dropped, "delegate")
        elif item.actor not in dedicated:
            problems.append(f"delegate_to_inline_actor:{item.actor}")
            _bump(dropped, "delegate")
        else:
            kept.append(item)
    return kept


def _declared_key(effect: Effect, state_keys: set[str]) -> str | None:
    """把 DM 写的效果规整到已登记的状态键。

    两种常见写法都要容忍（以 `<目标>.<量>` 为例）：
    - `target="<目标>", key="<量>"`
    - `target="<目标>.<量>", key="<量>"`（把键写进了 target）
    """
    candidates: list[str] = []
    if "." in effect.target:
        candidates.append(effect.target)
    candidates.append(effect.key if "." in effect.key else f"{effect.target}.{effect.key}")
    return next((candidate for candidate in candidates if candidate in state_keys), None)


def _clean_effects(pack: ScenarioPack, turn: DMTurn, problems: list[str], dropped: dict[str, int]) -> list[Effect]:
    """要判读的改动必须落在已登记的状态键上（未登记 = 丢弃并记账）。"""
    state_keys = set(pack.state_keys)
    kept: list[Effect] = []
    for effect in turn.effects:
        key = _declared_key(effect, state_keys)
        if key is None:
            problems.append(f"undeclared_state_key:{effect.target}.{effect.key}")
            _bump(dropped, "effects")
            continue
        target, _, bare_key = key.partition(".")
        kept.append(effect.model_copy(update={"target": target, "key": bare_key}))
    return kept


def _clean_reveals(pack: ScenarioPack, turn: DMTurn, problems: list[str], dropped: dict[str, int]) -> list[str]:
    cue_ids = {cue.id for cue in pack.setting.cues}
    kept: list[str] = []
    for cue_id in turn.reveals:
        if cue_id in cue_ids:
            kept.append(cue_id)
        else:
            problems.append(f"unknown_cue:{cue_id}")
            _bump(dropped, "reveals")
    return kept


def _option_problem(option: DMOption, pack: ScenarioPack, banned: list[str]) -> str | None:
    """返回该选项的问题；None = 合法。"""
    label = option.label.strip()
    if not label:
        return "empty_label"
    if any(marker in label.lower() for marker in _FREE_INPUT_LABELS):
        return "dm_supplied_free_input"
    hit = next((term for term in banned if term in label), None)
    if hit is not None:
        return f"leaked_fact_term:{hit}"
    if option.affordance_id is not None:
        if pack.affordance(option.affordance_id) is None:
            return f"unknown_affordance:{option.affordance_id}"
        return None
    if option.type is not AffordanceType.ASK:
        # 自由通道只对"发问"开放；其他动作必须有 pack 声明的 affordance
        return f"undeclared_affordance_type:{option.type}"
    return None


def _clean_options(
    pack: ScenarioPack, turn: DMTurn, world: World, problems: list[str], dropped: dict[str, int]
) -> list[DMOption]:
    banned = banned_terms(pack, world)
    kept: list[DMOption] = []
    for option in turn.options:
        problem = _option_problem(option, pack, banned)
        if problem is None:
            kept.append(option)
        else:
            problems.append(problem)
            _bump(dropped, "options")
    return kept


def _clean_images(pack: ScenarioPack, turn: DMTurn, problems: list[str], dropped: dict[str, int]) -> list[DMImage]:
    """图片只能来自 pack 声明的资源（作者的资源包）；未声明的丢弃并记账。"""
    known = {asset.id for asset in pack.assets}
    kept: list[DMImage] = []
    for image in turn.images:
        if image.asset_id in known:
            kept.append(image)
        else:
            problems.append(f"unknown_asset:{image.asset_id}")
            _bump(dropped, "images")
    return kept


def _clean_image_request(
    pack: ScenarioPack, turn: DMTurn, problems: list[str], dropped: dict[str, int]
) -> DMImageRequest | None:
    """绘画者 AI 的请求只在 pack 显式允许时成立（默认关闭，避免无谓成本）。"""
    request = turn.image_request
    if request is None:
        return None
    if pack.image_generation != "allowed" or not request.prompt.strip():
        problems.append("image_generation_disabled")
        _bump(dropped, "image_request")
        return None
    return request


def _clean_notes(pack: ScenarioPack, turn: DMTurn, problems: list[str], dropped: dict[str, int]) -> list[DMNote]:
    """白板笔记：包没开白板就不收；版块必须已声明；文本必须简短（白板不赘述）。"""
    if not turn.notes:
        return []
    board_sections = {section.id for section in pack.presentation.board}
    if not board_sections:
        problems.append("board_not_declared")
        _bump(dropped, "notes")
        return []
    kept: list[DMNote] = []
    for note in turn.notes:
        text = note.text.strip()
        if not text or len(text) > 40:
            _bump(dropped, "notes")
            continue
        if note.section and note.section not in board_sections:
            problems.append(f"unknown_board_section:{note.section}")
            _bump(dropped, "notes")
            continue
        kept.append(note.model_copy(update={"text": text}))
    return kept


def _clean_interpretation(
    pack: ScenarioPack, turn: DMTurn, world: World, problems: list[str], dropped: dict[str, int]
) -> DMInterpretation | None:
    """学生自由表达的归属：只认**已声明**且**此刻已解锁**的动作；越权即丢弃并记账。

    - 未声明 → `unknown_affordance`；已声明但那扇门还没开（`visible_when` 不成立）→ `locked_affordance`；
      两者都不写进记录——认错比漏认更坏，宁缺毋假。
    - 留空（缺省 / 空串）→ 原样留空，不编造归属。
    - `world` 为缺省（无世界）时，有门控的动作一律按未解锁处理（保守）。
    """
    raw = turn.interpretation
    if raw is None:
        return None
    affordance_id = (raw.affordance_id or "").strip()
    if not affordance_id:
        return None
    if pack.affordance(affordance_id) is None:
        problems.append(f"unknown_affordance:{affordance_id}")
        _bump(dropped, "interpretation")
        return None
    if affordance_id not in {affordance.id for affordance in visible_affordances(pack, world)}:
        problems.append(f"locked_affordance:{affordance_id}")
        _bump(dropped, "interpretation")
        return None
    return raw.model_copy(update={"affordance_id": affordance_id})


def validate_turn(pack: ScenarioPack, turn: DMTurn, world: World | None = None) -> TurnCheck:
    """按 pack 校验并清洗 DM 输出。非法项**丢弃并记账**，不让坏回合炸到学生面前。

    `world` 用于泄漏守卫：已揭示的事实不算泄底（DM 可以谈论学生已经看到的东西）。
    """
    problems: list[str] = []
    dropped: dict[str, int] = {}
    current = world if world is not None else World()
    clean = turn.model_copy(
        update={
            "lines": _clean_lines(pack, turn, problems, dropped),
            "delegate": _clean_delegate(pack, turn, problems, dropped),
            "effects": _clean_effects(pack, turn, problems, dropped),
            "reveals": _clean_reveals(pack, turn, problems, dropped),
            "options": _clean_options(pack, turn, current, problems, dropped),
            "images": _clean_images(pack, turn, problems, dropped),
            "image_request": _clean_image_request(pack, turn, problems, dropped),
            "notes": _clean_notes(pack, turn, problems, dropped),
            "interpretation": _clean_interpretation(pack, turn, current, problems, dropped),
            # facts_declared 是叙述证据，不是判读依据（判读读世界事实）→ 原样保留
            "facts_declared": list(turn.facts_declared),
        }
    )
    return TurnCheck(turn=clean, problems=problems, dropped=dropped)


@dataclass(frozen=True)
class AnchorProposalCheck:
    """锚点提案的裁决：要落的事件（kind, payload）与问题清单。"""

    events: tuple[tuple[str, dict[str, Any]], ...] = ()
    problems: tuple[str, ...] = ()


def validate_anchor_proposals(
    pack: ScenarioPack,
    report: AnchorReport,
    turn: DMTurn,
    *,
    turn_no: int,
) -> AnchorProposalCheck:
    """DM 的锚点提案：**只采纳与重算一致者**（docs/21 §4.0 的 `todo` 口径）。

    状态由事件流重算而来，所以"采纳"= 记一条达成/阻塞事件（真源仍是事件流 × 声明）；
    不一致 → 提案整条丢弃 + 落 `anchor_proposal_rejected` + 下回合注入纠偏
    （纠偏由 `runtime/anchors.py` 的 `AnchorReport.reminders` 生成）。

    与重算一致 = 重算状态下确已 `satisfied` / 确已 `blocked`；未声明的 id 一律拒绝。
    `anchor_blocked` 的 `reason` 记 DM 的说法；它没写就记引擎重算出的那个缺失步骤。
    """
    proposals: list[tuple[str, str, str]] = []  # (proposal 名, 锚点 id, DM 给的原因)
    if satisfied_id := turn.anchor_satisfied.strip():
        proposals.append(("anchor_satisfied", satisfied_id, ""))
    if turn.anchor_blocked is not None:
        blocked = turn.anchor_blocked
        proposals.append(("anchor_blocked", blocked.id.strip(), blocked.reason.strip()))
    if not proposals:
        return AnchorProposalCheck()

    states = {state.id: state for state in report.states}
    events: list[tuple[str, dict[str, Any]]] = []
    problems: list[str] = []
    for proposal, anchor_id, dm_reason in proposals:
        state = states.get(anchor_id)
        actual = state.status.value if state is not None else "undeclared"
        wanted = AnchorStatus.SATISFIED if proposal == "anchor_satisfied" else AnchorStatus.BLOCKED
        if state is not None and state.status is wanted:
            payload: dict[str, Any] = {"turn": turn_no, "anchor_id": anchor_id}
            if proposal == "anchor_blocked":
                payload["reason"] = dm_reason or state.reason
            events.append((proposal, payload))
            continue
        problems.append(f"anchor_proposal_rejected:{proposal}:{anchor_id}:{actual}")
        events.append(
            (
                "anchor_proposal_rejected",
                {"turn": turn_no, "anchor_id": anchor_id, "proposal": proposal, "actual": actual},
            )
        )
    return AnchorProposalCheck(events=tuple(events), problems=tuple(problems))
