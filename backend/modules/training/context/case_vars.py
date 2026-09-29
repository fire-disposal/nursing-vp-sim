"""病例 → 患者扮演模板变量（纯函数）。

这是患者 prompt 模板变量（``PATIENT_SYSTEM`` / ``PATIENT_DYNAMIC`` 的占位符）的
唯一渲染点：病例是数据，模板只消费变量，二者由本模块在**训练开始时按病例快照**
接合一次。评分提示词不在这里（见 ``scoring/prompt_builder.py``）。

能力边界：``case_data`` 里没有的键一律取默认文案，因此模板渲染不会因病例字段缺失
而失败（缺失字段是病例门禁的问题，不是提示词问题）。
"""

from __future__ import annotations

# ── 人格 trait 词汇表（case_data.personality 的六个维度，键序即渲染序）──────
_LITERACY = {
    "low": "不太会描述病情，用词简单模糊，经常答非所问",
    "normal": "能正常描述症状",
    "high": "能精准描述病情感受，偶尔冒出医学术语",
    "medium": "能正常描述症状",
}
_VERBOSITY = {"terse": "寡言少语、问三句答一句", "normal": "正常交流", "verbose": "话多健谈、容易跑题扯远"}
_ANXIETY_TRAIT = {"calm": "心态平和、不太当回事", "normal": "适度担心", "anxious": "容易紧张焦虑、反复确认"}
_PATIENCE = {"low": "耐心不足、容易急躁、可能怼人", "normal": "有耐心", "high": "话多反复讲同一件事"}
_MOOD = {
    "neutral": "",
    "low": "情绪低落、说话有气无力",
    "irritable": "烦躁易怒、对什么都挑剔",
    "fearful": "害怕自己的病很严重、说话带着恐惧",
}
_COMPLIANCE = {
    "resistant": "不太信任年轻护士、回答有所保留、可能质疑'你问这个干嘛'",
    "normal": "",
    "dependent": "过分依赖医护人员、反复确认自己做得对不对",
}

_TRAIT_TABLES: tuple[tuple[str, dict[str, str]], ...] = (
    ("health_literacy", _LITERACY),
    ("verbosity", _VERBOSITY),
    ("anxiety_trait", _ANXIETY_TRAIT),
    ("patience", _PATIENCE),
    ("mood", _MOOD),
    ("compliance", _COMPLIANCE),
)

#: 危险组合加成：(必要条件 trait→取值, 追加的行为描述)。命中即追加，可叠加。
_COMBO_BONUSES: tuple[tuple[dict[str, str], str], ...] = (
    ({"anxiety_trait": "anxious", "patience": "low"}, "你处于高度紧绷状态，随时可能情绪爆发或直接拒绝回答"),
    (
        {"health_literacy": "low", "compliance": "resistant"},
        "你不理解问题时会胡乱回答或转移话题，而不是承认自己不明白",
    ),
    ({"mood": "low", "compliance": "resistant"}, "你觉得说什么都没用，常常沉默或以'不知道'敷衍"),
    ({"anxiety_trait": "anxious", "compliance": "dependent"}, "你极度依赖对方给出肯定的回应，对方一犹豫你就更焦虑"),
)

#: 通用就诊场景（病例未提供 ``scene`` 时的 fallback；U0 病例应自带场景）。
_DEFAULT_SCENARIO = "你在医院就诊，一位护理学生（请称呼'护士'）正在采集你的病史。请根据你的主诉和现病史如实回答。"


def _text(case_data: dict, key: str, default: str = "无") -> str:
    """取病例字段的文本值；缺失或空白一律回落到默认文案。"""
    return str(case_data.get(key, "")).strip() or default


def _patient_info_line(patient_info: dict) -> str:
    """「姓名，N岁，性别」的展示行（缺项即省略）。"""
    name = str(patient_info.get("name", "患者"))
    parts = [name]
    if patient_info.get("age"):
        parts.append(f"{patient_info['age']}岁")
    if patient_info.get("gender"):
        parts.append(str(patient_info["gender"]))
    return "，".join(parts) if len(parts) > 1 else name


def _matches(personality: dict, required: dict[str, str]) -> bool:
    return all(personality.get(key) == value for key, value in required.items())


def _format_personality(personality: dict) -> str:
    """把六维人格映射成一段行为描述（缺失维度不产生文字）。"""
    if not personality:
        return "普通患者。"
    parts = (table.get(personality.get(key, ""), "") for key, table in _TRAIT_TABLES)
    base = "，".join(filter(None, parts)) + "。"
    bonuses = [text for required, text in _COMBO_BONUSES if _matches(personality, required)]
    return base + (" " + " ".join(bonuses) if bonuses else "")


def _format_deep_background(deep_background: dict) -> str:
    if not deep_background:
        return "（无额外背景信息）"
    return "\n".join(f"- {value}" for value in deep_background.values())


def build_case_vars(case_data: dict) -> dict[str, str]:
    """从 case_data 构建患者模板的变量字典。"""
    return {
        "patient_info": _patient_info_line(case_data.get("patient_info", {})) or "患者",
        "scenario": _DEFAULT_SCENARIO,
        "chief_complaint": _text(case_data, "chief_complaint"),
        "present_illness": _text(case_data, "present_illness"),
        "past_history": _text(case_data, "past_history", "无特殊既往史"),
        "medication_history": _text(case_data, "medication_history", "无长期用药"),
        "allergy_history": _text(case_data, "allergy_history", "无已知过敏史"),
        "family_history": _text(case_data, "family_history", "无特殊家族史"),
        "social_history": _text(case_data, "social_history", "无特殊社会史"),
        "communication_style": _text(case_data, "communication_style", "用口语化、真实患者的口吻交流。"),
        "personality": _format_personality(case_data.get("personality", {})),
        "deep_background": _format_deep_background(case_data.get("deep_background", {})),
    }
