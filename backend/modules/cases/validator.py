"""病例数据校验器 — CI / AI 生成闸门 / case-audit 三方复用。

设计原则（对应主程序对"病例字段过细分"的洞察）：
1. **字段必须消费端**：本文件维护字段消费端清单（taxonomy manifest）。
   无消费端的字段 = 死字段 = 过细分的税，校验器直接告警。
2. **跨字段一致性**：病例的矛盾（时间线/症状/人物/生理）本质是
   "多个字段各自维护同一叙事"的漂移——校验器负责把它们拉回一致。
3. 纯函数、无 IO（病例内容由调用方传入），可测试、可被 AI 代理消费。

规则分级：
- error   —— 教错学生或使训练逻辑矛盾，必须修
- warning —— 结构/时效/类型问题，允许存在但必须知道
- info    —— 校准提示
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from core.time_limits import MAX_TIME_LIMIT_MINUTES, MIN_TIME_LIMIT_MINUTES
from modules.training.activities import ACTIVITY_BINDINGS, ACTIVITY_CONFIG_KEY, ACTIVITY_IDS
from modules.training.profile import CLINICAL_REASONING
from modules.training.workflows import (
    CASE_WORKFLOW_FIELD,
    declared_workflow_id,
    registered_workflow_ids,
    startable_workflow_ids,
)
from schemas.case_schema import (
    ClinicalFindingKind,
    ClinicalRubricRule,
    ClinicalTriggerKind,
)

#: 临床判断训练的 workflow id（内容规则与之绑定：见 :func:`_check_clinical_reasoning`）。
CLINICAL_REASONING_ID = CLINICAL_REASONING.id

# ── 字段消费端清单（taxonomy manifest）───────────────────────────────────
# 值 = 消费模块。新增病例字段时必须同步登记；不在清单内的字段 = 死字段。

CONSUMED_FIELDS: dict[str, str] = {
    # 元数据三键：只在 cases 列保存（docs/15 §六），病例文件里的声明由 seed/写入侧落到列
    "name": "cases.name（文件声明 → 列；case_data 落库前剥离）",
    "difficulty": "cases.difficulty（同上；训练列表与难度校准读列）",
    "time_limit": "cases.time_limit_minutes（唯一口径 core/time_limits.resolve_time_limit_minutes）",
    "description": "病例选择页",
    "patient_info": "prompt_context_builder",
    "chief_complaint": "prompt_context_builder",
    "opening_line": "训练开场",
    "present_illness": "prompt_context_builder + 评分",
    "past_history": "prompt_context_builder",
    "medication_history": "prompt_context_builder",
    "allergy_history": "prompt_context_builder",
    "family_history": "prompt_context_builder",
    "social_history": "prompt_context_builder",
    "communication_style": "prompt_context_builder",
    "personality": "emotion profile + prompt",
    "deep_background": "prompt + leak_guard",
    "required_inquiries": "prompt + 评分",
    "example_dialogues": "few-shot (context/examples.py)",
    "activities": "Activity 声明（activities.<id>.config → ACTIVITY_BINDINGS / manifest）",
    "workflow": "训练入口解析（modules/training/workflows：CaseRevision 决定 → 记录冻结 workflow_id）",
    # 临床判断训练（docs/15 §十六）：六个声明面只属于 clinical_reasoning 病例，
    # 消费端 = 发布门禁（本模块 _check_clinical_reasoning）+ 后续切片的阶段链/证据/评分。
    "scenario": "clinical_reasoning 病例场景（发布门禁 _check_clinical_reasoning）",
    "findings": "clinical_reasoning 可获取证据目录（发布门禁 + Slice 2 证据获取）",
    "initial": "clinical_reasoning 开场可见/隐藏证据（发布门禁 + Slice 2 开场状态）",
    "progression": "clinical_reasoning 未处置状态变化（发布门禁 + Slice 2 回合推进）",
    "objectives": "clinical_reasoning 训练目标 must_notice/must_act/must_communicate（发布门禁 + Slice 2 判定）",
    "rubric": "clinical_reasoning 确定性锚点与权重（发布门禁 + Slice 2 评分域）",
    "voice_override": "voice.service 病例音色覆盖",
    "hidden_info": "prompt (format_case_for_prompt)",
    "scene": "训练开始/复盘：case_data.scene → runtime_state.scene（router/session.py）+ prompt_builder 注入",
    "variant_of": "校验器去重登记",
}

# Legacy/已移除消费端的字段——出现即告警（过细分残留）
LEGACY_FIELDS = {"phases", "voice_type", "capabilities", "tools", "exam_anchors", "training_type"}

# ── 规则常量 ──────────────────────────────────────────────────────────────

# 时间锚点：主诉时长 vs 示例中的时段描述（粗粒度，启发式）
_TIME_OF_DAY_ROUGH_HOURS = {
    "今天早上": 2,
    "今天上午": 3,
    "今天中午": 5,
    "今天下午": 8,
    "今天傍晚": 10,
    "今天晚上": 14,
    "昨晚": 16,
    "昨天晚上": 16,
    "昨天早上": 26,
    "昨天中午": 29,
    "前天": 40,
    "前天晚上": 44,
}
_TIME_MISMATCH_TOLERANCE_H = 10

# 症状否定 → 正向表达映射（示例中若出现正向表达 = 与现病史矛盾）
_SYMPTOM_POSITIVE: dict[str, list[str]] = {
    "呕吐": ["吐了", "呕吐", "吐了两回", "吐出来"],
    "腹泻": ["拉肚子", "腹泻", "水样便"],
    "咯血": ["咯血", "咳血", "痰里带血"],
    "黑便": ["黑便", "柏油便"],
    "便血": ["便血"],
    "晕厥": ["晕倒", "晕厥", "眼前发黑"],
    "抽搐": ["抽搐", "抽风"],
    "胸痛": ["胸痛", "胸口疼", "胸闷痛"],
    "尿频": ["尿频"],
}

# 人物关系：社会史中"配偶已故" vs 示例中"配偶在世"的冲突
_SPOUSE_DEAD = re.compile(r"(?:老伴|丈夫|妻子|爱人|配偶)[^。；;]{0,6}(?:去世|离世|过世|走了|没了)")
_SPOUSE_ALIVE_VERBS = ("扶", "帮", "照顾", "陪我", "说", "做", "分好", "带我", "送我")

_NEGATED = re.compile(r"(?:无明显|否认|无)([\u4e00-\u9fa5]{1,8}?)(?=[、，。；,;]|和|及|$)")

# 起病性动词：时间锚点只有修饰"起病"时才与主诉时长比对
# （示例中的"今天下午突然抽了"指事件而非起病，不算矛盾）
_ONSET_VERBS = ("开始", "烧起来", "疼起来", "出现", "发作", "突然后", "开始的", "就烧", "就疼")
_ONSET_WINDOW = 14
_YEAR = re.compile(r"(20\d{2})年")

FONTANELLE_TERMS = ("前囟", "后囟")


@dataclass
class CaseIssue:
    severity: str  # error | warning | info
    field: str
    message: str
    fix_hint: str = ""


@dataclass
class CaseReport:
    name: str
    issues: list[CaseIssue] = field(default_factory=list)

    @property
    def errors(self) -> list[CaseIssue]:
        return [i for i in self.issues if i.severity == "error"]

    @property
    def warnings(self) -> list[CaseIssue]:
        return [i for i in self.issues if i.severity == "warning"]

    @property
    def infos(self) -> list[CaseIssue]:
        return [i for i in self.issues if i.severity == "info"]

    def ok(self) -> bool:
        return not self.errors


def _e(msg: str, fld: str = "", hint: str = "") -> CaseIssue:
    return CaseIssue("error", fld, msg, hint)


def _w(msg: str, fld: str = "", hint: str = "") -> CaseIssue:
    return CaseIssue("warning", fld, msg, hint)


def _i(msg: str, fld: str = "") -> CaseIssue:
    return CaseIssue("info", fld, msg)


# ── 单病例规则 ────────────────────────────────────────────────────────────


def _check_time_anchors(c: dict, issues: list[CaseIssue]) -> None:
    """主诉时长与示例时段描述的一致性（启发式）。"""
    chief = str(c.get("chief_complaint", ""))
    present = str(c.get("present_illness", ""))
    m = re.search(r"(\d+)\s*(小时|天|周|月|年)", chief)
    if not m:
        return
    duration_h = {"小时": 1, "天": 24, "周": 168, "月": 720, "年": 8760}[m.group(2)] * int(m.group(1))

    for ex in c.get("example_dialogues", []):
        ans = str(ex.get("answer", ""))
        for phrase, rough_h in _TIME_OF_DAY_ROUGH_HOURS.items():
            idx = ans.find(phrase)
            if idx < 0:
                continue
            # 仅当短语后紧跟起病性描述时才与主诉时长比对
            tail = ans[idx + len(phrase) : idx + len(phrase) + _ONSET_WINDOW]
            if not any(v in tail for v in _ONSET_VERBS):
                continue
            if abs(rough_h - duration_h) > _TIME_MISMATCH_TOLERANCE_H:
                issues.append(
                    _e(
                        f"示例说'{phrase}'（约{rough_h}h 前），主诉时长'{m.group(0)}'（{duration_h}h）——时间线矛盾",
                        "example_dialogues",
                        "统一起病时间锚点（改示例或改主诉，二选一，推荐改示例）",
                    )
                )
            break  # 一条示例只判定第一个起病锚点


def _check_symptom_negation(c: dict, issues: list[CaseIssue]) -> None:
    """现病史否定症状 vs 示例正向表达。"""
    present = str(c.get("present_illness", ""))
    negated: set[str] = set()
    for mm in _NEGATED.finditer(present):
        token = mm.group(1)
        if len(token) >= 2 and token in _SYMPTOM_POSITIVE:
            negated.add(token)

    if not negated:
        return
    _NEG_PREFIX = ("没", "没有", "不", "无", "未曾", "从不")
    for ex in c.get("example_dialogues", []):
        ans = str(ex.get("answer", ""))
        for token in negated:
            for positive in _SYMPTOM_POSITIVE[token]:
                idx = ans.find(positive)
                while idx >= 0:
                    prefix = ans[max(0, idx - 6) : idx]
                    if not any(prefix.rstrip().endswith(n) or n in prefix[-3:] for n in _NEG_PREFIX):
                        issues.append(
                            _e(
                                f"现病史否认'{token}'（{positive}），示例却出现正向表达——症状矛盾",
                                "example_dialogues",
                                "统一症状描述：改现病史或改示例（推荐改示例，现病史是评分依据）",
                            )
                        )
                        return
                    idx = ans.find(positive, idx + 1)


def _check_person_relation(c: dict, issues: list[CaseIssue]) -> None:
    """社会史中配偶已故 vs 示例中配偶在世。"""
    social = str(c.get("social_history", ""))
    spouse_dead = _SPOUSE_DEAD.search(social)
    if not spouse_dead:
        return
    for ex in c.get("example_dialogues", []):
        ans = str(ex.get("answer", ""))
        if any(v in ans for v in ("老伴", "丈夫", "妻子", "爱人")):
            # 排除示例中自己说明"已故"的情况
            if "去" in ans and ("世" in ans or "了" in ans):
                continue
            if any(v in ans for v in _SPOUSE_ALIVE_VERBS):
                issues.append(
                    _e(
                        f"社会史表示配偶已故，示例却以在世口吻提及（{spouse_dead.group(0)}）",
                        "example_dialogues",
                        "示例改用其他人物（邻居/子女）或统一社会史",
                    )
                )
                return


def _check_fontanelle(c: dict, issues: list[CaseIssue]) -> None:
    """年龄-前囟：前囟 12-18 月龄闭合，≥2 岁仍写前囟 = 医学硬伤。"""
    age = str(c.get("patient_info", {}).get("age", "")).strip()
    if not age:
        return
    age_months = re.search(r"(\d+)\s*个月", age)
    if age_months:
        too_old = int(age_months.group(1)) >= 18
    else:
        age_num = re.search(r"\d+", age)
        too_old = bool(age_num) and int(age_num.group(0)) >= 2
    if not too_old:
        return
    skin = json_text(_physical_exam_config(c).get("skin", {}))
    for term in FONTANELLE_TERMS:
        if term in skin:
            issues.append(
                _e(
                    f"患者 {age} 岁，查体仍写'{term}'（前囟 12-18 月龄闭合）——医学硬伤",
                    "activities.physical_exam.config.skin",
                    "删除前囟描述，改'头颅无畸形'等适龄表述",
                )
            )
            return


def _check_example_count(c: dict, issues: list[CaseIssue]) -> None:
    n = len(c.get("example_dialogues", []))
    if not 3 <= n <= 5:
        issues.append(_e(f"example_dialogues 数量 {n}，应为 3-5 条", "example_dialogues", "补齐或裁剪示例对话"))


def _check_year_freshness(c: dict, issues: list[CaseIssue]) -> None:
    now_year = datetime.now(UTC).year
    for fld in ("present_illness", "past_history", "social_history"):
        text = str(c.get(fld, ""))
        for mm in _YEAR.finditer(text):
            y = int(mm.group(1))
            if y < now_year - 1:
                issues.append(
                    _w(
                        f"病史出现绝对年份 '{mm.group(0)}'（当前 {now_year}），时间线会随岁月失真",
                        fld,
                        "改为相对时间（'4个月前''3周前'）更持久",
                    )
                )


def _check_dead_fields(c: dict, issues: list[CaseIssue]) -> None:
    for k in c:
        if k in LEGACY_FIELDS:
            issues.append(
                _w(
                    f"字段 '{k}' 已无消费端（legacy 残留）——过细分的税",
                    k,
                    "删除字段或登记消费端",
                )
            )
        elif k not in CONSUMED_FIELDS:
            issues.append(
                _w(
                    f"字段 '{k}' 未登记消费端——死字段或新字段未接入",
                    k,
                    "在 validator.CONSUMED_FIELDS 登记消费端，或删除",
                )
            )


def _check_activities(c: dict, issues: list[CaseIssue]) -> None:
    """Activity 声明质量门禁（docs/15 §四/§十）。

    病例只能声明内核认识的 Activity；声明了但配置不可用 = 「配置了却不可达」，
    必须在**发布前**报错，而不是在运行时静默变成一块死面板。
    """
    if "activities" not in c:
        issues.append(
            _e(
                "缺少 activities 声明：该病例没有任何可用 Activity",
                "activities",
                "按 activities.<id>.config 声明（docs/15 §四），如 "
                '{"activities": {"physical_exam": {"config": {...}}}}',
            )
        )
        return

    activities = c.get("activities")
    if not isinstance(activities, dict) or not activities:
        issues.append(_e("activities 必须是非空对象（id → {config: …}）", "activities"))
        return

    for activity_id, declaration in activities.items():
        field = f"activities.{activity_id}"
        if activity_id not in ACTIVITY_BINDINGS:
            issues.append(
                _e(
                    f"病例声明了内核不认识的 activity '{activity_id}'——发布即失败，不允许「配置了但不可达」",
                    field,
                    f"允许的 id: {', '.join(ACTIVITY_IDS)}",
                )
            )
            continue
        if not isinstance(declaration, dict):
            issues.append(_e(f"{field} 必须是对象（{{config: …}}）", field, "改为一层声明信封"))
            continue
        if ACTIVITY_CONFIG_KEY not in declaration:
            issues.append(_e(f"{field} 缺少 config（Activity 的病例配置）", field))
            continue
        _check_activity_config(activity_id, declaration[ACTIVITY_CONFIG_KEY], field, issues)


def _check_workflow(c: dict, issues: list[CaseIssue]) -> None:
    """workflow 声明质量门禁（docs/15 §二、§十六）。

    病例只能声明**已登记**的 workflow：声明了内核不认识的工作区 = 发布出去也进不去，
    必须在发布前报错，而不是等学员开始训练时才解析失败（与 ``_check_activities`` 同策）。
    只有一条**可开始**的 workflow 时允许省略声明；登记第二条可开始的 workflow 之后，
    省略即 error —— 病例必须自己说明跑哪条闭包，否则解析会被拒绝（绝不猜成第一条）。
    """
    known = registered_workflow_ids()
    startable = startable_workflow_ids()
    allowed = ", ".join(known)
    if CASE_WORKFLOW_FIELD not in c:
        if len(startable) > 1:
            issues.append(
                _e(
                    "已登记多个可开始的 workflow，病例必须显式声明 workflow —— 否则解析时会被拒绝",
                    CASE_WORKFLOW_FIELD,
                    f'加 {{"workflow": "<id>"}}；允许的 id: {allowed}',
                )
            )
        return

    declared = declared_workflow_id(c)
    if declared is None:
        issues.append(
            _e(
                f"{CASE_WORKFLOW_FIELD} 必须是非空字符串（workflow id）",
                CASE_WORKFLOW_FIELD,
                f"允许的 id: {allowed}",
            )
        )
        return
    if declared not in known:
        issues.append(
            _e(
                f"病例声明了未登记的 workflow '{declared}'——发布即失败，不允许「声明了但不可达」",
                CASE_WORKFLOW_FIELD,
                f"允许的 id: {allowed}",
            )
        )


def _check_activity_config(activity_id: str, config: Any, field: str, issues: list[CaseIssue]) -> None:
    """各 Activity 的配置形状（消费端是 handler / 查体规则模块）。"""
    if activity_id == "physical_exam":
        if not isinstance(config, dict) or not config:
            issues.append(_e(f"{field}.config 必须是非空对象（查体锚点）", f"{field}.config"))
            return
        if not any(config.get(key) for key in ("vital_signs", "groups", "skin")):
            issues.append(
                _e(
                    f"{field}.config 未包含 vital_signs / groups / skin，无法解析任何查体项",
                    f"{field}.config",
                    "至少声明 vital_signs（关键异常体征）",
                )
            )
        return

    if activity_id == "quiz":
        questions = config.get("questions") if isinstance(config, dict) else None
        if not isinstance(questions, list) or not questions:
            issues.append(
                _e(
                    f"{field}.config 必须含非空 questions（否则面板弹出即空）",
                    f"{field}.config",
                    "补题目或删除该 activity 声明",
                )
            )
        return

    if activity_id == "nursing_record":
        if not isinstance(config, (bool, dict)):
            issues.append(_e(f"{field}.config 必须是对象或布尔（当前类型 {type(config).__name__}）", f"{field}.config"))
        return

    if activity_id == "nursing_diagnosis":
        if not isinstance(config, dict):
            issues.append(_e(f"{field}.config 必须是对象", f"{field}.config"))
        issues.append(
            _w(
                f"{field} 只写 runtime_state、无正式产物（docs/15 §三禁止），不得进入生产 manifest",
                field,
                "并入护理评估的结构化字段后删除该声明",
            )
        )


# ── 临床判断训练病例门禁（docs/15 §十六）─────────────────────────────────
# 只在病例声明 ``workflow: "clinical_reasoning"`` 时生效；不套用到问诊病例。
# 每条 error 都指向作者可见的 JSON 路径（field）+ 可执行的修复方向（fix_hint）。

#: 六个声明面（全顶层键）—— 只属于 ``clinical_reasoning`` 病例。
CLINICAL_CONTENT_FIELDS: tuple[str, ...] = ("scenario", "findings", "initial", "progression", "objectives", "rubric")

#: 目标三组：发现 / 行动 / 沟通。
_OBJECTIVE_GROUPS: tuple[str, ...] = ("must_notice", "must_act", "must_communicate")

_FINDING_KINDS: tuple[str, ...] = tuple(kind.value for kind in ClinicalFindingKind)
_TRIGGER_KINDS: tuple[str, ...] = tuple(kind.value for kind in ClinicalTriggerKind)
_RUBRIC_RULES: tuple[str, ...] = tuple(rule.value for rule in ClinicalRubricRule)

_FINDING_REF_LABEL = "证据（findings[].id）"
_OBJECTIVE_REF_LABEL = "目标（objectives.*[].id）"


@dataclass
class _ClinicalEntry:
    """索引里的一条声明（值 + 作者可见路径）—— 报错必须指向作者自己写的那个位置。"""

    value: dict
    path: str


@dataclass
class _ClinicalContent:
    """病例已声明的临床内容索引（各检查函数共用，避免逐个传参）。"""

    findings: dict[str, _ClinicalEntry]
    objectives: dict[str, _ClinicalEntry]
    #: 目标 id → 所属组（must_notice / must_act / must_communicate）
    groups: dict[str, str]


def _non_empty_str(entry: dict, key: str, path: str, issues: list[CaseIssue], *, what: str) -> None:
    value = entry.get(key)
    if not isinstance(value, str) or not value.strip():
        issues.append(_e(f"{path}.{key} 必须是非空字符串（{what}）", f"{path}.{key}"))


def _clinical_id(entry: dict, path: str, index: dict[str, _ClinicalEntry], issues: list[CaseIssue]) -> str | None:
    """把 ``entry["id"]`` 登记进索引；缺失/含空白/重复即报错并放弃该条。"""
    raw = entry.get("id")
    if not isinstance(raw, str) or not raw.strip():
        issues.append(_e(f"{path}.id 必须是非空字符串（它是被 objective/rubric 引用的键）", f"{path}.id"))
        return None
    value = raw.strip()
    if any(ch.isspace() for ch in value):
        issues.append(_e(f"{path}.id 不能含空白 —— 引用键要能原样比对", f"{path}.id", "如 n.低氧 / n.hypoxemia"))
        return None
    if value in index:
        issues.append(
            _e(
                f"{path}.id '{value}' 与 {index[value].path}.id 重复 —— 引用会产生歧义",
                f"{path}.id",
                "改成唯一 id",
            )
        )
        return None
    index[value] = _ClinicalEntry(entry, path)
    return value


def _checked_refs(
    entry: dict,
    key: str,
    path: str,
    known: dict[str, _ClinicalEntry],
    issues: list[CaseIssue],
    *,
    what: str,
) -> list[str]:
    """读取一组引用 id；形状非法 / 指向不存在的 id 即报错（返回仍然可用的引用）。"""
    raw = entry.get(key)
    if raw is None:
        return []
    if not isinstance(raw, list) or not all(isinstance(v, str) and v.strip() for v in raw):
        issues.append(_e(f"{path}.{key} 必须是字符串数组（引用{what}）", f"{path}.{key}"))
        return []
    refs: list[str] = []
    for j in range(len(raw)):
        value = raw[j]
        if not isinstance(value, str) or not value.strip():
            issues.append(_e(f"{path}.{key}[{j}] 必须是非空字符串（引用{what}）", f"{path}.{key}[{j}]"))
            continue
        ref = value.strip()
        if ref not in known:
            issues.append(
                _e(
                    f"{path}.{key}[{j}] 引用了不存在的{what} '{ref}'",
                    f"{path}.{key}[{j}]",
                    f"可用 id: {', '.join(sorted(known)) or '（无）'}",
                )
            )
            continue
        refs.append(ref)
    return refs


def _obtainable_via(entry: dict) -> list[str]:
    raw = entry.get("obtainable_via")
    if not isinstance(raw, list):
        return []
    return [v.strip() for v in raw if isinstance(v, str) and v.strip()]


def _declared_list(entry: dict, key: str) -> bool:
    """该键是否**写了非空数组**（区分「没写」与「写了但引用不存在」——后者已由引用检查报出）。"""
    raw = entry.get(key)
    return isinstance(raw, list) and len(raw) > 0


def _check_clinical_scenario(c: dict, issues: list[CaseIssue]) -> None:
    scenario = c.get("scenario")
    if not isinstance(scenario, dict):
        issues.append(
            _e(
                "缺少 scenario —— 必须声明 title / setting / summary（场景与任务摘要）",
                "scenario",
                '例如 {"title": "术后低氧", "setting": "外科病房", "summary": "……", "learner_brief": "……"}',
            )
        )
        return
    for key, what in (("title", "病例标题"), ("setting", "场景（在哪、面对谁）"), ("summary", "场景摘要")):
        _non_empty_str(scenario, key, "scenario", issues, what=what)


def _check_clinical_findings(c: dict, issues: list[CaseIssue]) -> dict[str, _ClinicalEntry]:
    """校验可获取证据目录，返回 ``id → 条目`` 索引。"""
    index: dict[str, _ClinicalEntry] = {}
    raw = c.get("findings")
    if not isinstance(raw, list) or not raw:
        issues.append(
            _e(
                "findings 必须是非空数组 —— 证据目录为空等于学生无据可判",
                "findings",
                '例如 {"findings": [{"id": "f.spo2", "label": "SpO2 88%", "kind": "vital_sign", '
                '"critical": true, "obtainable_via": ["exam:vital_signs"]}]}',
            )
        )
        return index
    kinds = ", ".join(_FINDING_KINDS)
    for i in range(len(raw)):
        item = raw[i]
        path = f"findings[{i}]"
        if not isinstance(item, dict):
            issues.append(_e(f"{path} 必须是对象（id/label/kind）", path))
            continue
        _clinical_id(item, path, index, issues)
        _non_empty_str(item, "label", path, issues, what="证据在面板上的可读名")
        kind = item.get("kind")
        if not isinstance(kind, str) or kind not in _FINDING_KINDS:
            issues.append(
                _e(
                    f"{path}.kind 必须是 {kinds} 之一（当前 {kind!r}）",
                    f"{path}.kind",
                    "kind 决定学生从哪条途径拿到它",
                )
            )
        critical = item.get("critical")
        if critical is not None and not isinstance(critical, bool):
            issues.append(_e(f"{path}.critical 必须是布尔值", f"{path}.critical"))
        if "obtainable_via" in item:
            via = item.get("obtainable_via")
            if not isinstance(via, list) or not all(isinstance(v, str) and v.strip() for v in via):
                issues.append(_e(f"{path}.obtainable_via 必须是字符串数组（获取途径）", f"{path}.obtainable_via"))
    return index


def _check_clinical_initial(c: dict, content: _ClinicalContent, issues: list[CaseIssue]) -> None:
    """开场状态：可见/隐藏互斥，且**每条证据都必须有获取方式**（否则永远拿不到）。"""
    raw = c.get("initial")
    if not isinstance(raw, dict):
        issues.append(
            _e(
                "缺少 initial —— 必须声明开场哪些证据可见、哪些需要主动获取",
                "initial",
                '例如 {"visible_findings": ["f.spo2"], "hidden_findings": ["f.crp"]}',
            )
        )
        return
    visible = _checked_refs(raw, "visible_findings", "initial", content.findings, issues, what=_FINDING_REF_LABEL)
    hidden = _checked_refs(raw, "hidden_findings", "initial", content.findings, issues, what=_FINDING_REF_LABEL)
    for fid in sorted(set(visible) & set(hidden)):
        issues.append(
            _e(
                f"证据 '{fid}' 同时出现在 initial.visible_findings 与 initial.hidden_findings —— 二者互斥",
                "initial.hidden_findings",
                "开场就看得见的留在 visible_findings；需要主动获取的放 hidden_findings",
            )
        )
    for fid, entry in content.findings.items():
        if fid in hidden:
            if not _obtainable_via(entry.value):
                issues.append(
                    _e(
                        f"隐藏证据 '{fid}' 的 obtainable_via 为空 —— 学生没有任何途径拿到它",
                        f"{entry.path}.obtainable_via",
                        '声明获取途径（如 ["lab:CBC"]），或改为 initial.visible_findings',
                    )
                )
            continue
        if fid in visible:
            continue
        label = "关键证据" if entry.value.get("critical") is True else "证据"
        issues.append(
            _e(
                f"{label} '{fid}' 没有任何获取方式：既不在 initial.visible_findings，也不在 initial.hidden_findings —— 学生永远拿不到它",
                entry.path,
                "在 initial 里登记它：开场可见 → visible_findings；需主动获取 → hidden_findings（并声明 obtainable_via）",
            )
        )


def _check_clinical_objectives(
    c: dict, findings: dict[str, _ClinicalEntry], issues: list[CaseIssue]
) -> tuple[dict[str, _ClinicalEntry], dict[str, str]]:
    """校验三类目标，返回 ``id → 条目`` 与 ``id → 所属组`` 两个索引。"""
    raw = c.get("objectives")
    if not isinstance(raw, dict):
        issues.append(
            _e(
                "缺少 objectives —— 必须声明 must_notice / must_act / must_communicate",
                "objectives",
                '例如 {"must_notice": [{"id": "n.1", "label": "识别低氧", "finding": "f.spo2"}], '
                '"must_act": [{"id": "a.1", "label": "立即给氧", "action": "启动吸氧"}], '
                '"must_communicate": [{"id": "c.1", "label": "报告医生", "cue": "SBAR 报告 SpO2 88%"}]}',
            )
        )
        return {}, {}
    index: dict[str, _ClinicalEntry] = {}
    groups: dict[str, str] = {}
    for group in _OBJECTIVE_GROUPS:
        path0 = f"objectives.{group}"
        items = raw.get(group)
        if not isinstance(items, list) or not items:
            issues.append(
                _e(
                    f"{path0} 必须是非空数组 —— 目标声明为空等于这个维度没有被考核",
                    path0,
                    "至少声明一条（确实不需要该维度应由产品决定，不由空数组静默跳过）",
                )
            )
            continue
        for i in range(len(items)):
            item = items[i]
            path = f"{path0}[{i}]"
            if not isinstance(item, dict):
                issues.append(_e(f"{path} 必须是对象（id/label/…）", path))
                continue
            oid = _clinical_id(item, path, index, issues)
            if oid is not None:
                groups[oid] = group
            _non_empty_str(item, "label", path, issues, what="目标的可读名")
            if group == "must_notice":
                ref = item.get("finding")
                ref_text = ref.strip() if isinstance(ref, str) else ref
                if ref_text not in findings:
                    issues.append(
                        _e(
                            f"{path}.finding 必须引用已声明的证据（当前 {ref!r} 不存在）",
                            f"{path}.finding",
                            f"可用 id: {', '.join(sorted(findings)) or '（无）'}",
                        )
                    )
            elif group == "must_act":
                _non_empty_str(item, "action", path, issues, what="学生必须完成的动作 —— 空声明无法判定")
            else:
                _non_empty_str(item, "cue", path, issues, what="必须传达的信息 —— 空声明无法判定")
    return index, groups


def _check_progression_trigger(trigger: Any, path: str, content: _ClinicalContent, issues: list[CaseIssue]) -> None:
    """触发条件必须可判定：时间触发要有时间，条件触发要指向已声明的证据或目标。"""
    kinds = ", ".join(_TRIGGER_KINDS)
    if not isinstance(trigger, dict):
        issues.append(
            _e(
                f"{path} 必须声明触发条件（kind + after_minutes 或 ref）",
                path,
                f'kind ∈ {kinds}；时间触发用 {{"kind": "time", "after_minutes": 5}}，'
                '条件触发用 {"kind": "finding"|"objective", "ref": "<id>"}',
            )
        )
        return
    kind = trigger.get("kind")
    if not isinstance(kind, str) or kind not in _TRIGGER_KINDS:
        issues.append(_e(f"{path}.kind 必须是 {kinds} 之一（当前 {kind!r}）", f"{path}.kind"))
        return
    if kind == "time":
        after = trigger.get("after_minutes")
        if not isinstance(after, int) or isinstance(after, bool) or after < 1:
            issues.append(
                _e(
                    f"{path}.after_minutes 必须是 ≥1 的整数分钟 —— time 触发没有时间就没有触发点",
                    f"{path}.after_minutes",
                )
            )
        return
    known = content.findings if kind == "finding" else content.objectives
    what = _FINDING_REF_LABEL if kind == "finding" else _OBJECTIVE_REF_LABEL
    ref = trigger.get("ref")
    ref_text = ref.strip() if isinstance(ref, str) else ref
    if ref_text not in known:
        issues.append(
            _e(
                f"{path}.ref 必须引用已声明的{what}（当前 {ref!r} 不存在）",
                f"{path}.ref",
                f"可用 id: {', '.join(sorted(known)) or '（无）'}",
            )
        )


def _check_clinical_progression(c: dict, content: _ClinicalContent, issues: list[CaseIssue]) -> None:
    """未处置的推进：触发条件必须可判定，且真的改变状态。"""
    raw = c.get("progression")
    if raw is None:
        issues.append(
            _w(
                "未声明 progression：学生不作为时患者状态不变（若本病例确有恶化/时限压力，请补上）",
                "progression",
                '例如 [{"id": "p.1", "trigger": {"kind": "time", "after_minutes": 5}, '
                '"state_changes": {"spo2": 84}, "description": "未吸氧 → 低氧加重"}]',
            )
        )
        return
    if not isinstance(raw, list):
        issues.append(_e("progression 必须是数组（未处置的状态变化）", "progression"))
        return
    index: dict[str, _ClinicalEntry] = {}
    for i in range(len(raw)):
        item = raw[i]
        path = f"progression[{i}]"
        if not isinstance(item, dict):
            issues.append(_e(f"{path} 必须是对象（id/trigger/state_changes）", path))
            continue
        _clinical_id(item, path, index, issues)
        _check_progression_trigger(item.get("trigger"), f"{path}.trigger", content, issues)
        changes = item.get("state_changes")
        if not isinstance(changes, dict) or not changes:
            issues.append(
                _e(
                    f"{path}.state_changes 必须是非空对象 —— 没有状态变化就不是推进",
                    f"{path}.state_changes",
                    '例如 {"spo2": 84, "consciousness": "drowsy"}',
                )
            )


def _check_rubric_anchor(
    anchor: Any,
    path: str,
    index: dict[str, _ClinicalEntry],
    content: _ClinicalContent,
    covered: set[str],
    issues: list[CaseIssue],
) -> None:
    """单个锚点：id/label/rule/weight 合法，引用存在，且规则与引用类型一致。"""
    if not isinstance(anchor, dict):
        issues.append(_e(f"{path} 必须是对象（id/label/rule/weight）", path))
        return
    _clinical_id(anchor, path, index, issues)
    _non_empty_str(anchor, "label", path, issues, what="锚点的可读名")
    rule = anchor.get("rule")
    if not isinstance(rule, str) or rule not in _RUBRIC_RULES:
        issues.append(
            _e(
                f"{path}.rule 必须是 {', '.join(_RUBRIC_RULES)} 之一（当前 {rule!r}）",
                f"{path}.rule",
                "规则决定判定方式：能算的不用 LLM 判",
            )
        )
    weight = anchor.get("weight")
    if isinstance(weight, bool) or not isinstance(weight, (int, float)) or weight <= 0:
        issues.append(_e(f"{path}.weight 必须是 > 0 的数字（相对权重）", f"{path}.weight"))
    obj_refs = _checked_refs(anchor, "objectives", path, content.objectives, issues, what=_OBJECTIVE_REF_LABEL)
    find_refs = _checked_refs(anchor, "findings", path, content.findings, issues, what=_FINDING_REF_LABEL)
    covered.update(obj_refs)
    # 引用「写了但不存在」由 _checked_refs 报出；这里只补「根本没写」的情况，不重复报。
    if rule == "finding_observed":
        if not find_refs and not _declared_list(anchor, "findings"):
            issues.append(
                _e(
                    f"{path}.findings 不能为空：finding_observed 锚点必须引用它判定的证据",
                    f"{path}.findings",
                    f"引用 {_FINDING_REF_LABEL}，或把 rule 改成 objective_met",
                )
            )
        return
    if (
        rule in {"objective_met", "action_taken", "communicated"}
        and not obj_refs
        and not _declared_list(anchor, "objectives")
    ):
        issues.append(
            _e(
                f"{path}.objectives 不能为空：{rule} 锚点必须引用它判定的目标",
                f"{path}.objectives",
                f"引用 {_OBJECTIVE_REF_LABEL}，或把 rule 改成 finding_observed",
            )
        )
    if rule not in {"action_taken", "communicated"}:
        return
    expected = "must_act" if rule == "action_taken" else "must_communicate"
    for ref in obj_refs:
        if content.groups.get(ref) != expected:
            issues.append(
                _e(
                    f"{path}.objectives 引用的 '{ref}' 属于 objectives.{content.groups.get(ref, '?')}，"
                    f"与 rule={rule} 矛盾（该规则只判定 objectives.{expected}）",
                    f"{path}.objectives",
                    f"改用 objectives.{expected} 里的目标 id，或把 rule 改成 objective_met",
                )
            )


def _check_clinical_rubric(c: dict, content: _ClinicalContent, issues: list[CaseIssue]) -> None:
    """确定性锚点：引用必须存在、规则与引用类型必须一致、每个目标都要被锚点覆盖。"""
    raw = c.get("rubric")
    anchors = raw.get("anchors") if isinstance(raw, dict) else None
    if not isinstance(anchors, list) or not anchors:
        issues.append(
            _e(
                "rubric.anchors 必须是非空数组 —— 没有确定性锚点就没有可判分的依据",
                "rubric.anchors",
                '例如 {"rubric": {"anchors": [{"id": "r.1", "label": "识别低氧并及时给氧", '
                '"rule": "objective_met", "weight": 2, "objectives": ["n.1", "a.1"]}]}}',
            )
        )
        return
    index: dict[str, _ClinicalEntry] = {}
    covered: set[str] = set()
    for i in range(len(anchors)):
        _check_rubric_anchor(anchors[i], f"rubric.anchors[{i}]", index, content, covered, issues)
    for oid, entry in content.objectives.items():
        if oid not in covered:
            issues.append(
                _e(
                    f"目标 '{oid}' 没有任何 rubric 锚点引用 —— 学生做到了也无人判分",
                    entry.path,
                    "在 rubric.anchors[].objectives 里引用它，或删除该目标",
                )
            )


def _check_clinical_reasoning(c: dict, issues: list[CaseIssue]) -> None:
    """``clinical_reasoning`` 病例的内容门禁（docs/15 §十六）。

    规则都是**结构可判**的：证据可达性、引用完整性、目标与锚点互相覆盖。「关键证据拿不到」
    「目标没有锚点」这类问题不能留到运行期才发现 —— 学生的判断会建立在不可能获取的证据上，
    评分也会凭借空锚点给分。
    """
    if c.get("activities"):
        issues.append(
            _e(
                "clinical_reasoning 的 Activity 白名单当前为空（学生工作区待接入）：病例不得声明 activities —— 配置了也没有入口",
                "activities",
                "删除 activities 声明；证据获取在后续切片由该 workflow 自带的阶段链声明",
            )
        )
    _check_clinical_scenario(c, issues)
    findings = _check_clinical_findings(c, issues)
    objectives, groups = _check_clinical_objectives(c, findings, issues)
    content = _ClinicalContent(findings=findings, objectives=objectives, groups=groups)
    _check_clinical_initial(c, content, issues)
    _check_clinical_progression(c, content, issues)
    _check_clinical_rubric(c, content, issues)


def _check_clinical_content_declaration(c: dict, issues: list[CaseIssue]) -> None:
    """临床判断字段只属于 ``clinical_reasoning`` 病例。

    这些键一旦出现而病例没有声明 ``workflow: "clinical_reasoning"``，病例会被解析成问诊
    病例：学生会进入一条问诊工作区，而病例没有任何问诊内容（患者信息/示例对话），结果
    是一条无法渲染、无法评分的训练。所以发布前必须点名，而不是等训练开始后才暴露。
    """
    present = [key for key in CLINICAL_CONTENT_FIELDS if key in c]
    if not present:
        return
    declared = declared_workflow_id(c)
    issues.append(
        _e(
            f"病例含临床判断字段（{', '.join(present)}），但 workflow 声明为 {declared or '（未声明）'} —— "
            "这些字段不会被消费，学生进入的是问诊工作区",
            CASE_WORKFLOW_FIELD,
            f'加 {{"workflow": "{CLINICAL_REASONING_ID}"}}，或删除这些字段',
        )
    )


def _check_time_limit(c: dict, issues: list[CaseIssue]) -> None:
    tl = c.get("time_limit")
    if not isinstance(tl, (int, float)):
        return
    if tl < MIN_TIME_LIMIT_MINUTES:
        issues.append(
            _e(
                f"time_limit={tl} 分钟 < 下限 {MIN_TIME_LIMIT_MINUTES} 分钟",
                "time_limit",
                f"改为 {MIN_TIME_LIMIT_MINUTES}–{MAX_TIME_LIMIT_MINUTES} 之间的声明值；生效值不再由代码改写",
            )
        )
    elif tl > MAX_TIME_LIMIT_MINUTES:
        issues.append(
            _e(
                f"time_limit={tl} 分钟 > 上限 {MAX_TIME_LIMIT_MINUTES} 分钟",
                "time_limit",
                f"改为 {MIN_TIME_LIMIT_MINUTES}–{MAX_TIME_LIMIT_MINUTES} 之间的声明值",
            )
        )


def _check_difficulty_content(c: dict, issues: list[CaseIssue]) -> None:
    diff = c.get("difficulty")
    n = len(c.get("required_inquiries", []))
    if diff == 1 and n >= 16:
        issues.append(
            _i(
                f"难度 1 但必询项 {n} 条偏多（供评分域难度校准参考）",
                "difficulty",
            )
        )


def _physical_exam_config(c: dict) -> dict:
    """病例声明的查体配置（未声明 / 形状不符 → 空配置）。"""
    raw = c.get("activities")
    declaration: dict = raw if isinstance(raw, dict) else {}
    entry = declaration.get("physical_exam")
    config = entry.get(ACTIVITY_CONFIG_KEY) if isinstance(entry, dict) else None
    return config if isinstance(config, dict) else {}


def validate_case(case_data: dict) -> CaseReport:
    """校验单个病例，返回报告（纯函数）。

    规则按病例声明的 workflow 分流（docs/15 §十六）：``clinical_reasoning`` 病例走临床判断
    门禁（证据可达性 / 引用完整性 / 锚点覆盖），其余病例（含未声明 —— 唯一**可开始**的
    workflow 是 history_taking）走原有问诊规则。两套规则不互相套用：临床判断病例没有示例
    对话与必询项，问诊病例没有证据目录。共用规则（时长、死字段、难度校准）对两者都生效。
    """
    report = CaseReport(name=str(case_data.get("name", "?")))
    issues = report.issues
    _check_workflow(case_data, issues)
    if declared_workflow_id(case_data) == CLINICAL_REASONING_ID:
        _check_clinical_reasoning(case_data, issues)
    else:
        _check_clinical_content_declaration(case_data, issues)
        _check_activities(case_data, issues)
        _check_time_anchors(case_data, issues)
        _check_symptom_negation(case_data, issues)
        _check_person_relation(case_data, issues)
        _check_fontanelle(case_data, issues)
        _check_example_count(case_data, issues)
        _check_year_freshness(case_data, issues)
    _check_dead_fields(case_data, issues)
    _check_time_limit(case_data, issues)
    _check_difficulty_content(case_data, issues)
    return report


# ── 跨病例规则 ────────────────────────────────────────────────────────────


def _check_duplicate_patients(reports: dict[str, CaseReport], cases: dict[str, dict]) -> None:
    """同名患者跨文件去重：要求显式声明 variant_of。"""
    by_name: dict[str, list[str]] = {}
    for fname, c in cases.items():
        name = str(c.get("patient_info", {}).get("name", ""))
        if name:
            by_name.setdefault(name, []).append(fname)
    for name, files in by_name.items():
        if len(files) < 2:
            continue
        for fname in files:
            if not cases[fname].get("variant_of"):
                reports[fname].issues.append(
                    _w(
                        f"患者 '{name}' 与其他病例重复（{', '.join(f for f in files if f != fname)}）",
                        "patient_info.name",
                        "加 variant_of 声明变体关系，或改为独立患者",
                    )
                )
            else:
                reports[fname].issues.append(_i(f"患者 '{name}' 已声明 variant_of={cases[fname]['variant_of']}"))


def _check_nursing_record_consistency(reports: dict[str, CaseReport], cases: dict[str, dict]) -> None:
    """``activities.nursing_record.config`` 类型全库统一（bool 或 dict 二选一）。"""
    kinds: dict[str, list[str]] = {}
    for fname, c in cases.items():
        raw = c.get("activities")
        declaration: dict = raw if isinstance(raw, dict) else {}
        entry = declaration.get("nursing_record")
        config = entry.get(ACTIVITY_CONFIG_KEY) if isinstance(entry, dict) else None
        if config is None and entry is None:
            continue
        kinds.setdefault(type(config).__name__, []).append(fname)
    if len(kinds) > 1:
        desc = "; ".join(f"{k}({', '.join(v)})" for k, v in kinds.items())
        for fname in cases:
            reports[fname].issues.append(
                _w(
                    f"nursing_record 配置类型全库不统一：{desc}",
                    "activities.nursing_record.config",
                    "统一为 object（带 hints）或 bool（见字段粒度收敛决策）",
                )
            )


def validate_cases(cases: dict[str, dict]) -> dict[str, CaseReport]:
    """校验一批病例（文件名 → 病例数据），含跨病例规则。"""
    reports = {fname: validate_case(c) for fname, c in cases.items()}
    _check_duplicate_patients(reports, cases)
    _check_nursing_record_consistency(reports, cases)
    return reports


def load_cases_from_dir(cases_dir: str | Path) -> dict[str, dict]:
    """读取 data/cases 下全部 JSON（含 quiz），供 case-audit 与测试复用。"""
    import json

    d = Path(cases_dir)
    out: dict[str, dict] = {}
    for p in sorted(d.glob("*.json")):
        try:
            out[p.stem] = json.loads(p.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            out[p.stem] = {"name": p.stem, "_parse_error": str(exc)}
    return out


def json_text(v) -> str:
    """把任意 JSON 值转成文本（用于 skin 等嵌套结构检索）。"""
    import json

    if isinstance(v, str):
        return v
    return json.dumps(v, ensure_ascii=False)
