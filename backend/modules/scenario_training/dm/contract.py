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

import re
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from infra.llm import safe_parse_json
from infra.llm.parsing import TruncatedJSONError

from ..runtime.world import World, facts_observed
from ..schema import AffordanceType, Effect, ScenarioPack

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


class DMTurn(BaseModel):
    """DM 单回合输出。字段缺失一律按空处理，不抛。"""

    model_config = ConfigDict(extra="ignore")

    narration: str = ""
    lines: list[DMLine] = Field(default_factory=list)
    delegate: list[DMDelegate] = Field(default_factory=list)
    facts_declared: list[DMFact] = Field(default_factory=list)
    notes: list[DMNote] = Field(default_factory=list)  # 写在线索板上的判断/订正（简短）
    effects: list[Effect] = Field(default_factory=list)
    reveals: list[str] = Field(default_factory=list)
    ad_hoc_cues: list[str] = Field(default_factory=list)  # DM 即兴的可见线索（标记来源）
    options: list[DMOption] = Field(default_factory=list)
    images: list[DMImage] = Field(default_factory=list)  # 展示 pack 内的预定义图片
    image_request: DMImageRequest | None = None  # 预留：请求绘画者 AI 生成（需 pack 允许）


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
            # facts_declared 是叙述证据，不是判读依据（判读读世界事实）→ 原样保留
            "facts_declared": list(turn.facts_declared),
        }
    )
    return TurnCheck(turn=clean, problems=problems, dropped=dropped)
