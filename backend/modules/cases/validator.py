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

# ── 字段消费端清单（taxonomy manifest）───────────────────────────────────
# 值 = 消费模块。新增病例字段时必须同步登记；不在清单内的字段 = 死字段。

CONSUMED_FIELDS: dict[str, str] = {
    "name": "case 列表/评分",
    "difficulty": "训练列表",
    "time_limit": "计时器 (D5: 生效值 max(30, ...))",
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
    "tools": "查体/护理记录工具",
    "hidden_info": "prompt (format_case_for_prompt)",
    "quiz": "引导式测验工具",
    "nursing_record": "护理记录工具 (类型待收敛)",
    "scene": "前端 SceneRenderer",
    "variant_of": "校验器去重登记",
}

# Legacy/已移除消费端的字段——出现即告警（过细分残留）
LEGACY_FIELDS = {"phases", "exam_anchors", "voice_type", "voice_override", "capabilities"}

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
    skin = json_text(c.get("tools", {}).get("physical_exam", {}).get("skin", {}))
    for term in FONTANELLE_TERMS:
        if term in skin:
            issues.append(
                _e(
                    f"患者 {age} 岁，查体仍写'{term}'（前囟 12-18 月龄闭合）——医学硬伤",
                    "tools.physical_exam.skin",
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


def _check_time_limit(c: dict, issues: list[CaseIssue]) -> None:
    tl = c.get("time_limit")
    if isinstance(tl, (int, float)) and tl < 30:
        issues.append(
            _w(
                f"time_limit={tl} 分钟 < 硬截止 30 分钟（D5）",
                "time_limit",
                "生效值由代码 max(30, ...) 决定；数据建议同步改 30",
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


def validate_case(case_data: dict) -> CaseReport:
    """校验单个病例，返回报告（纯函数）。"""
    report = CaseReport(name=str(case_data.get("name", "?")))
    _check_time_anchors(case_data, report.issues)
    _check_symptom_negation(case_data, report.issues)
    _check_person_relation(case_data, report.issues)
    _check_fontanelle(case_data, report.issues)
    _check_example_count(case_data, report.issues)
    _check_year_freshness(case_data, report.issues)
    _check_dead_fields(case_data, report.issues)
    _check_time_limit(case_data, report.issues)
    _check_difficulty_content(case_data, report.issues)
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
    """tools.nursing_record 类型全库统一（bool 或 dict 二选一，待字段粒度收敛决策）。"""
    kinds: dict[str, list[str]] = {}
    for fname, c in cases.items():
        nr = c.get("tools", {}).get("nursing_record")
        kinds.setdefault(type(nr).__name__, []).append(fname)
    if len(kinds) > 1:
        desc = "; ".join(f"{k}({', '.join(v)})" for k, v in kinds.items())
        for fname in cases:
            reports[fname].issues.append(
                _w(
                    f"nursing_record 类型全库不统一：{desc}",
                    "tools.nursing_record",
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
