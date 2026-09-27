"""情境解释器 —— 「病例」与「情境」之间的**纯函数**翻译层（今天不接入运行期）。

## 这一层回答什么

``schema.Situation`` 是**新的作者面**。本模块负责回答一个可证伪的问题：**它装不装得下今天的
问诊体裁？** 给出的东西只有两件：

1. :func:`situation_from_case` / :func:`case_from_situation`：病例 ↔ 情境的**无 IO 双向翻译**；
   ``case_data`` 逐字段往返相等由 ``tests/situations/test_interpreter.py`` 钉住（case1 + 4 个蓝图病例
   逐字段相等，目录里全部 14 个真实病例的消费端视图相等）；
2. :func:`apply_timeline` / :func:`affordance_report`：契约里两条「不许猜」规则的可执行版本
   （触发条件只认可观测键；未注册 affordance key 必须点名）。

**本模块今天没有被任何运行期代码调用**：读它的只有测试。不接入是迁移顺序问题 ——
先用往返证明「情境装得下今天的病例」，再谈把 ``CaseRevision.content`` 换成 Situation、
把 ``runtime_state["scene"]`` 交给 ``state`` + ``timeline``。

## 字段归属表（一个事实一个 owner；``MAPPED_FIELDS`` 就是这张表的可执行版本）

| 病例字段 | 情境位置 | 为什么 |
|---|---|---|
| ``name`` / ``description`` | ``title`` / ``brief`` | 病例文档的抬头 |
| ``patient_info`` | ``actors[patient].name`` + ``actors[patient].visible`` | 年龄/性别是在场者**可见**的那部分 |
| 主诉 / 现病史 / 既往史 / 用药史 / 过敏史 / 家族史 / 社会史 | ``state.facts[字段名]``，字段名进 ``actors[patient].knows`` | actor 只声明**谁知道哪些事实**（知识边界），事实的值只有 ``state`` 一个 owner；把文本抄进 ``knows`` 就是同一事实两个 owner |
| ``personality`` | ``actors[patient].behavior`` | 契约指定沿用现行六维键名，直接复用患者提示词 |
| ``communication_style`` / ``example_dialogues`` | ``actors[patient]`` 的 extra 键 | 契约今天没有这两个字段（``Actor`` 允许 extra 原样往返：先写、后解释），而两者的消费端都在**患者扮演**上（说话方式与风格示例） |
| ``opening_line`` | ``actors[patient].opening`` | 契约字段原文：他先开口说什么 |
| ``deep_background`` | ``state.hidden[键]``，键名进 ``actors[patient].unaware`` | 与 ``knows`` 对称：值一个 owner，键一个 owner |
| ``required_inquiries`` | ``learner.required_inquiries`` | 「要采集什么」是**学生**这一侧的任务，不是患者的属性 |
| ``activities`` | ``affordances[]``：``key`` 由 ``AFFORDANCE_BY_ACTIVITY`` 映射，原始**声明体**原样留在 ``config`` | 「能做的一件事」取代「一个工具」；来源标记使反向翻译不需要猜 |
| ``scene`` | ``environment``（原样承载） | 环境 + 可见体征 + 定性呼吸线索（``patient.breathing``） |
| 其余一切字段（``difficulty`` / ``time_limit`` / ``blueprint`` / ``variant_of`` / 未来的新字段…） | 顶层 extra 键 ``case_fields``（原样） | 情境契约今天没有位置，但**不得丢弃**；等 schema 长出对应字段再搬过去 |

## 缺省 = 今天的行为（迁移靠这条）

- 病例体裁不声明时间轴 → ``timeline = []``，状态不随回合变化；
- 只有一个 ``in_person`` 在场者（``patient``）→ 语义与现行单患者问诊一致；
- ``affordances`` 只由病例声明的 ``activities`` 派生，**不**凭空补一个对话 affordance；
- ``judgment = []``：现行 rubric 是中心 rubric，本切片不反推它（没有声明就不判读）。

## 显式声明的规约（是规约，不是静默丢失）

- **空声明 ≡ 未声明**：``personality: {}`` / ``patient_info: {}`` / ``deep_background: {}`` /
  ``scene: {}`` / ``scene: null`` / 缺键，在消费端本就等价（``_format_personality({})`` == 缺键、
  ``_patient_info_line({})`` == 缺键、``_format_deep_background({})`` == 缺键、
  ``SceneState.model_validate({})`` == 缺 ``scene``），因此反向翻译统一按「非空才声明」产出。
  有值的字段一律原样，**含空串与 ``null``**（``state.facts`` 按「病例里声明了这个键」收录）。
- **形状不符 = 未声明（不猜、不转、不丢）**：``personality`` / ``patient_info`` /
  ``deep_background`` / ``scene`` / ``activities`` 若不是映射，``name`` / ``description`` /
  ``opening_line`` 若不是字符串（``null`` 除外），则该位置按未声明处理，**原值退回**
  ``case_fields``。
- **两个结构性键总会产出**：反译总是给出 ``scene``（``environment`` 为空 → ``None``）与
  ``activities``（没有 affordance → ``{}``）。消费端对「缺失 / ``null`` / 空容器」不加区分
  （``router/session.py::_seed_scene`` 是 ``dict(raw) if isinstance(raw, dict) else {}``，
  ``training/activities._declarations`` 同理），所以这是消费端等价的选择，
  而不是把「缺键」改成「有键」的语义变化。
- **``vitals`` 原样承载**：契约 §4 说数字只能由 affordance 产出，但今天 ``case_data.scene.vitals``
  本来就带数字、本来就被注入患者提示词。本切片按「缺省 = 今天的行为」原样承载，不在解释器里
  悄悄删掉（那是改行为，且不是在解释器里改）。
- **``affordances[].effects`` / ``.targets`` 今天留空**：病例声明没有给出「这个 affordance 改哪些
  ``state`` 键 / 作用在谁身上」的机器可读来源，反推要复用 ``tools/physical_exam._VITALS_MAP``
  之类的实现细节 —— 留空比猜一个映射诚实（下一片的事）。
- **``apply_timeline`` 的 ``when`` 只对入参 ``state`` 求值**（一次调用内不级联）：
  命中集合是 ``(when, turns, elapsed_seconds, state, applied)`` 的纯函数，没有隐藏的链式推进。
- **反译只服务本模块的转换**：``case_from_situation`` 要求 affordance 带 ``case_activity_id`` /
  ``case_declaration`` 来源标记，缺标记即报错（不靠映射表反猜来源）。
"""

from __future__ import annotations

from collections.abc import Mapping
from copy import deepcopy
from dataclasses import dataclass
from typing import Any, Final

from modules.situations.schema import Actor, Affordance, Situation, TimelineStep
from modules.training.activities import (
    ACTIVITY_BINDINGS,
    activity_config,
    declared_activity_ids,
)
from modules.training.context.case_vars import build_case_vars
from modules.training.context.examples import build_example_pairs
from modules.training.session.state import SceneState, format_scene_for_prompt

# ── 常量（词表与默认值都写在明面上，解释器不猜）────────────────────────────

#: 在场者 id：现行问诊体裁判（今天唯一的在场者）
PATIENT_ACTOR_ID: Final = "patient"
#: 在场者角色标签（病例只声明患者，故由本层给出这一个标签）
PATIENT_ACTOR_ROLE: Final = "患者"
#: 学生角色（本切片唯一的 learner 声明）
LEARNER_ROLE: Final = "nursing_student"
#: 默认 workflow：``history_taking`` = 今天唯一可开始的闭包（缺省 = 今天的行为）
DEFAULT_WORKFLOW_ID: Final = "history_taking"

#: 患者提示词里的**可见事实**字段（顺序 = ``build_case_vars`` 的渲染顺序）。
#: 值进 ``state.facts``，键名进 ``Actor.knows``。
FACT_FIELDS: Final[tuple[str, ...]] = (
    "chief_complaint",
    "present_illness",
    "past_history",
    "medication_history",
    "allergy_history",
    "family_history",
    "social_history",
)

#: 挂在 ``Actor`` extra 上的病例字段（情境契约今天没有对应字段，按 extra「先写、后解释」原样承载）
ACTOR_EXTRA_FIELDS: Final[tuple[str, ...]] = ("communication_style", "example_dialogues")

#: 「情境今天没有位置」的病例字段落点（顶层 extra）：原样保留，不丢不改
CASE_FIELDS_KEY: Final = "case_fields"

#: 有专属位置的病例字段 → 情境位置（**代码与文档共用的唯一一张表**）
MAPPED_FIELDS: Final[dict[str, str]] = {
    "name": "title",
    "description": "brief",
    "patient_info": "actors[patient].name + .visible",
    "personality": "actors[patient].behavior",
    "opening_line": "actors[patient].opening",
    "deep_background": "state.hidden + actors[patient].unaware",
    "required_inquiries": "learner.required_inquiries",
    "activities": "affordances[]",
    "scene": "environment",
    **{field: f"state.facts[{field}] + actors[patient].knows" for field in FACT_FIELDS},
    **{field: f"actors[patient].extra[{field}]" for field in ACTOR_EXTRA_FIELDS},
}

#: 病例 ``activities`` 的 id → affordance key（契约词表：一个能力 = 学生能做的一件事）
AFFORDANCE_BY_ACTIVITY: Final[dict[str, str]] = {
    "physical_exam": "measure",
    "nursing_record": "record",
    "quiz": "quiz",
}

#: 已注册的 affordance key。前七个来自契约 docstring 的稳定词表；``quiz`` 是病例可声明的
#: activity（``diabetes_foot_quiz.json``）→ 不登记的话解释器自己就会产出「未注册的 key」。
AFFORDANCE_VOCABULARY: Final[frozenset[str]] = frozenset(
    {"ask", "examine", "measure", "record", "escalate", "handover", "order", "quiz"}
)

#: ``TimelineStep.when`` 允许的**可观测**键（其余键名报错，不猜学生意图）
WHEN_KEYS: Final[tuple[str, ...]] = ("turns_gte", "elapsed_gte", "state_eq")


# ── 病例 → 情境 ───────────────────────────────────────────────────────────


def situation_from_case(case_data: Mapping[str, Any], *, workflow_id: str = DEFAULT_WORKFLOW_ID) -> Situation:
    """把一份病例（今天的学生训练内容）表达成一个 :class:`Situation`。

    纯函数：不读文件、不写库、不碰全局状态；返回的情境与原病例**不共享可变对象**
    （全量深拷贝，改原病例不会动到情境）。
    """
    # 兜底桶：情境今天没有位置（或声明形状与位置不符）的字段原样留在这里
    unmapped: dict[str, Any] = {key: deepcopy(value) for key, value in case_data.items() if key not in MAPPED_FIELDS}

    def mapping_of(key: str) -> dict[str, Any]:
        """映射型声明（深拷贝：情境与病例不共享可变对象）；``null`` 按未声明，形状不符退回 ``unmapped``。"""
        value = case_data.get(key)
        if value is None:
            return {}
        if isinstance(value, Mapping):
            return deepcopy(dict(value))
        unmapped[key] = deepcopy(value)
        return {}

    def text_of(key: str) -> str:
        """文本型声明；``null`` 按未声明，形状不符则原值退回 ``unmapped``。"""
        value = case_data.get(key)
        if value is None:
            return ""
        if isinstance(value, str):
            return value
        unmapped[key] = deepcopy(value)
        return ""

    # 事实：键在病例里就算声明（空串 / null 也原样带着，消费端 _text 会照常处理）
    facts = {key: deepcopy(case_data[key]) for key in FACT_FIELDS if key in case_data}
    hidden = {key: deepcopy(value) for key, value in mapping_of("deep_background").items()}
    patient_info = mapping_of("patient_info")

    actor_extra = {key: deepcopy(case_data[key]) for key in ACTOR_EXTRA_FIELDS if key in case_data}
    patient = Actor(
        id=PATIENT_ACTOR_ID,
        name=str(patient_info.get("name") or ""),
        role=PATIENT_ACTOR_ROLE,
        medium="in_person",
        knows=list(facts),
        unaware=list(hidden),
        behavior=mapping_of("personality"),
        # 年龄/性别等「看得见」的人口学信息（name 已有自己的位置）
        visible={key: deepcopy(value) for key, value in patient_info.items() if key != "name"},
        opening=text_of("opening_line"),
        **actor_extra,
    )

    learner: dict[str, Any] = {"role": LEARNER_ROLE, "workflow": workflow_id}
    if case_data.get("required_inquiries") is not None:
        learner["required_inquiries"] = deepcopy(case_data["required_inquiries"])

    return Situation(
        title=text_of("name"),
        brief=text_of("description"),
        learner=learner,
        actors=[patient],
        environment=mapping_of("scene"),
        state={"facts": facts, "hidden": hidden},
        # 病例体裁不声明时间轴 → 空（缺省 = 今天的行为：状态不随回合变化）
        timeline=[],
        affordances=_affordances_from_case(case_data, unmapped),
        # 现行 rubric 是中心 rubric，本切片不反推判读维度（没有声明就不判读）
        judgment=[],
        # ``case_fields`` 是 extra 字段（``Situation`` 的 ``extra="allow"``）；ty 看不到 pydantic 的 extra 通道
        **{CASE_FIELDS_KEY: unmapped},  # ty: ignore[invalid-argument-type]
    )


def _affordances_from_case(case_data: Mapping[str, Any], unmapped: dict[str, Any]) -> list[Affordance]:
    """病例 ``activities`` → ``affordances``（声明体原样留在 ``config``，供反译与审计）。"""
    raw = case_data.get("activities")
    if raw is None:
        return []
    if not isinstance(raw, Mapping):
        unmapped["activities"] = deepcopy(raw)  # 形状不符 → 原样退回，不丢
        return []
    declarations = {str(key): value for key, value in raw.items()}
    return [_affordance(activity_id, declarations[activity_id]) for activity_id in declared_activity_ids(case_data)]


def _affordance(activity_id: str, declaration: Any) -> Affordance:
    if activity_id not in ACTIVITY_BINDINGS:
        raise ValueError(f"病例声明的 activity {activity_id!r} 未在 ACTIVITY_BINDINGS 登记（先登记再声明）")
    key = AFFORDANCE_BY_ACTIVITY.get(activity_id)
    if key is None:
        raise ValueError(
            f"activity {activity_id!r} 尚无 affordance 映射（AFFORDANCE_BY_ACTIVITY 目前只有 "
            f"{sorted(AFFORDANCE_BY_ACTIVITY)}）；补映射之前不猜一个 key"
        )
    return Affordance(
        key=key,
        label=ACTIVITY_BINDINGS[activity_id].label,
        config={"case_activity_id": activity_id, "case_declaration": deepcopy(declaration)},
    )


# ── 情境 → 病例 ───────────────────────────────────────────────────────────


def case_from_situation(situation: Situation) -> dict[str, Any]:
    """把情境反译回病例形状（纯函数，只读情境）。

    用途是**往返证明**：``case_from_situation(situation_from_case(case))`` 与原病例逐字段相等。
    它不是通用的「情境降级成病例」：affordance 必须带 ``case_activity_id`` / ``case_declaration``
    来源标记（缺了就是手写情境，本函数无权替它猜来源）。
    """
    case: dict[str, Any] = deepcopy(dict((situation.model_extra or {}).get(CASE_FIELDS_KEY) or {}))
    if situation.title:
        case["name"] = situation.title
    if situation.brief:
        case["description"] = situation.brief

    if "required_inquiries" in situation.learner:
        case["required_inquiries"] = deepcopy(situation.learner["required_inquiries"])

    # 事实：facts 的键名就是病例字段名（值原样，含空串 / null）
    case.update({key: deepcopy(value) for key, value in _mapping_of(situation.state.get("facts")).items()})
    hidden = _mapping_of(situation.state.get("hidden"))
    if hidden:
        case["deep_background"] = deepcopy(hidden)

    patient = next((actor for actor in situation.actors if actor.id == PATIENT_ACTOR_ID), None)
    if patient is not None:
        case.update(_actor_case_fields(patient))

    case["activities"] = _declarations_from_affordances(situation)
    case["scene"] = deepcopy(situation.environment) if situation.environment else None
    return case


def _actor_case_fields(patient: Actor) -> dict[str, Any]:
    """在场者 → 病例字段（``patient_info`` / ``personality`` / ``opening_line`` / extra 两键）。"""
    fields: dict[str, Any] = {}
    patient_info: dict[str, Any] = {"name": patient.name} if patient.name else {}
    patient_info.update({key: deepcopy(value) for key, value in patient.visible.items()})
    if patient_info:
        fields["patient_info"] = patient_info
    if patient.behavior:
        fields["personality"] = dict(patient.behavior)
    if patient.opening:
        fields["opening_line"] = patient.opening
    extra = patient.model_extra or {}
    for field in ACTOR_EXTRA_FIELDS:
        if field in extra:
            fields[field] = deepcopy(extra[field])
    return fields


def _declarations_from_affordances(situation: Situation) -> dict[str, Any]:
    declarations: dict[str, Any] = {}
    for affordance in situation.affordances:
        config = affordance.config or {}
        activity_id = config.get("case_activity_id")
        if not isinstance(activity_id, str) or "case_declaration" not in config:
            raise ValueError(
                f"affordance {affordance.key!r} 缺少 case_activity_id / case_declaration 来源标记；"
                "手写情境不能反译回病例声明（不猜来源）"
            )
        declarations[activity_id] = deepcopy(config["case_declaration"])
    return declarations


def _mapping_of(value: Any) -> dict[str, Any]:
    """情境里的映射型容器（深拷贝：反译结果与情境不共享可变对象）。"""
    return deepcopy(dict(value)) if isinstance(value, Mapping) else {}


# ── 消费端视图（往返断言的落点）────────────────────────────────────────────


def case_consumed_view(case_data: Mapping[str, Any]) -> dict[str, Any]:
    """病例的**消费端视图**：今天真正被读的那几样东西的规范化投影。

    每一项都走现行消费者自己的函数/访问器，不在解释器里重写一遍格式化逻辑：
    患者提示词变量（``context/case_vars``）、开场白、scene 结构化字段与注入提示词的 scene 块
    （``session/state``）、activity 声明集合（``training/activities``）、要采集的问题清单、
    few-shot 示例对（``context/examples``）。
    """
    scene = case_data.get("scene")
    return {
        "patient_prompt_vars": build_case_vars(dict(case_data)),
        "opening_line": case_data.get("opening_line", ""),
        "scene": _scene_fields(scene),
        "scene_block": _scene_block(scene),
        "activities": {
            activity_id: activity_config(case_data, activity_id) for activity_id in declared_activity_ids(case_data)
        },
        "required_inquiries": list(case_data.get("required_inquiries") or []),
        "example_dialogues": build_example_pairs(dict(case_data)),
    }


def situation_consumed_view(situation: Situation) -> dict[str, Any]:
    """情境的消费端视图 = 把情境反译回病例形状后，喂给**同一批**消费函数。

    这条路径只读 ``situation``（不接触原病例）：两边逐字段相等 =
    「情境装得下这个病例」的可检验形式。
    """
    return case_consumed_view(case_from_situation(situation))


def _scene_fields(scene: Any) -> dict[str, Any]:
    """``scene`` 的结构化投影（``SceneState`` 的字段与缺省；契约外未知键按缺省丢弃，与消费端一致）。

    形状不合 ``SceneState`` 时抛 ``ValidationError`` —— 报错，不猜。
    """
    return SceneState.model_validate(scene if isinstance(scene, Mapping) else {}).model_dump()


def _scene_block(scene: Any) -> str:
    """真正被注入患者提示词的 scene 文本（``session/state.format_scene_for_prompt``）。"""
    return format_scene_for_prompt(SceneState.model_validate(scene if isinstance(scene, Mapping) else {}))


# ── 时间轴推进 ────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class Utterance:
    """时间轴让某个在场者说出的一句话（``say`` 为空则不产生发言）。"""

    speaker: str | None
    say: str


@dataclass(frozen=True)
class ApplyResult:
    """一次时间轴推进的结果：状态补丁 + 发出的发言/事件 + 新的 ``applied`` 集合。"""

    patch: dict[str, Any]
    utterances: tuple[Utterance, ...]
    events: tuple[dict[str, Any], ...]
    applied: set[str]

    def next_state(self, state: Mapping[str, Any]) -> dict[str, Any]:
        """把补丁落到状态上（**顶层键**平铺合并：``patch`` 的键就是 ``state`` 的键）。"""
        return {**state, **self.patch}


def apply_timeline(
    situation: Situation,
    state: Mapping[str, Any],
    *,
    turns: int,
    elapsed_seconds: float,
    applied: set[str],
) -> ApplyResult:
    """找出 ``when`` 已满足且未应用过的步骤，返回补丁 / 发言 / 事件 / 新的 ``applied``。

    协议（契约 §1「timeline 只改 state」+ §2「只应用声明，不猜」）：

    - ``when`` 只支持 :data:`WHEN_KEYS` 三个可观测键，其余键名**在求值前**报错
      （整份 timeline 先校验一遍，不会「应用了一半才发现声明非法」）；键名不认识 → ``ValueError``，
      阈值/``state_eq`` 的类型不对 → ``TypeError``（不猜，也不静默比较）；
    - ``when`` 一律对**入参 ``state``** 求值，一次调用内不级联；
    - ``once=True`` 的步骤已应用过就跳过（``applied`` 是唯一账本，本函数不改写入参集合）；
    - 无命中 → ``patch == {}``、``utterances == ()``、``events == ()``、``applied`` 原样返回，
      状态逐字节不变；
    - 多个步骤命中时按声明顺序合并补丁：同一键由**后声明**的步骤覆盖（声明顺序即优先级）。
    """
    for step in situation.timeline:
        _check_when_keys(step)

    patch: dict[str, Any] = {}
    utterances: list[Utterance] = []
    events: list[dict[str, Any]] = []
    next_applied = set(applied)
    for step in situation.timeline:
        if step.once and step.id in applied:
            continue
        if not _when_satisfied(step, state, turns, elapsed_seconds):
            continue
        patch.update(deepcopy(step.patch))
        if step.say:
            utterances.append(Utterance(speaker=step.speaker, say=step.say))
        if step.event is not None:
            events.append(deepcopy(step.event))
        next_applied.add(step.id)
    return ApplyResult(patch=patch, utterances=tuple(utterances), events=tuple(events), applied=next_applied)


def _check_when_keys(step: TimelineStep) -> None:
    unknown = sorted(set(step.when) - set(WHEN_KEYS))
    if unknown:
        raise ValueError(
            f"timeline 步骤 {step.id!r} 的 when 含不可观测键 {unknown}；只支持 {list(WHEN_KEYS)}"
            "（触发条件只认回合数 / 经过时间 / 状态取值，不猜学生意图）"
        )


def _when_satisfied(step: TimelineStep, state: Mapping[str, Any], turns: int, elapsed_seconds: float) -> bool:
    when = step.when
    if "turns_gte" in when and turns < _threshold(step, "turns_gte"):
        return False
    if "elapsed_gte" in when and elapsed_seconds < _threshold(step, "elapsed_gte"):
        return False
    if "state_eq" in when:
        expected = when["state_eq"]
        if not isinstance(expected, Mapping):
            raise TypeError(f"timeline 步骤 {step.id!r} 的 state_eq 必须是「键 → 取值」映射，得到 {expected!r}")
        if any(state.get(key) != value for key, value in expected.items()):
            return False
    return True


def _threshold(step: TimelineStep, key: str) -> float:
    value = step.when[key]
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise TypeError(f"timeline 步骤 {step.id!r} 的 {key} 必须是数字，得到 {value!r}（不猜字符串阈值）")
    return value


# ── affordance 登记检查 ───────────────────────────────────────────────────


def affordance_report(situation: Situation, known_keys: set[str]) -> list[str]:
    """情境声明了、但**不认识**的 affordance key（点名，不静默丢弃）。

    ``known_keys`` = 调用方认识的 key 集合（如前端 renderer 登记表或
    :data:`AFFORDANCE_VOCABULARY`）；返回按字典序排好的未注册 key。
    """
    return sorted({affordance.key for affordance in situation.affordances if affordance.key not in known_keys})
