"""History taking context kwargs builder — extracts template variables from case_data."""

import logging

log = logging.getLogger(__name__)


def build_context_kwargs(case_data: dict) -> dict[str, str]:
    """从 case_data 构建该 profile 的模板变量字典。"""

    def _get(key: str, default: str = "无") -> str:
        return str(case_data.get(key, "")).strip() or default

    def _format_personality(p: dict) -> str:
        if not p:
            return "普通患者。"
        parts = []
        lit = {
            "low": "不太会描述病情，用词简单模糊，经常答非所问",
            "normal": "能正常描述症状",
            "high": "能精准描述病情感受，偶尔冒出医学术语",
            "medium": "能正常描述症状",
        }
        verb = {"terse": "寡言少语、问三句答一句", "normal": "正常交流", "verbose": "话多健谈、容易跑题扯远"}
        anx = {"calm": "心态平和、不太当回事", "normal": "适度担心", "anxious": "容易紧张焦虑、反复确认"}
        pat = {"low": "耐心不足、容易急躁、可能怼人", "normal": "有耐心", "high": "话多反复讲同一件事"}
        mood = {
            "neutral": "",
            "low": "情绪低落、说话有气无力",
            "irritable": "烦躁易怒、对什么都挑剔",
            "fearful": "害怕自己的病很严重、说话带着恐惧",
        }
        compliance = {
            "resistant": "不太信任年轻护士、回答有所保留、可能质疑'你问这个干嘛'",
            "normal": "",
            "dependent": "过分依赖医护人员、反复确认自己做得对不对",
        }
        for key, mapping in [
            ("health_literacy", lit),
            ("verbosity", verb),
            ("anxiety_trait", anx),
            ("patience", pat),
            ("mood", mood),
            ("compliance", compliance),
        ]:
            val = mapping.get(p.get(key, ""), "")
            if val:
                parts.append(val)

        combo = []
        # 组合加成：危险搭配产生更强烈的行为描述
        is_anxious = p.get("anxiety_trait") == "anxious"
        is_low_patience = p.get("patience") == "low"
        is_low_lit = p.get("health_literacy") in ("low",)
        is_resistant = p.get("compliance") == "resistant"
        is_low_mood = p.get("mood") == "low"

        if is_anxious and is_low_patience:
            combo.append("你处于高度紧绷状态，随时可能情绪爆发或直接拒绝回答")
        if is_low_lit and is_resistant:
            combo.append("你不理解问题时会胡乱回答或转移话题，而不是承认自己不明白")
        if is_low_mood and is_resistant:
            combo.append("你觉得说什么都没用，常常沉默或以'不知道'敷衍")
        if is_anxious and p.get("compliance") == "dependent":
            combo.append("你极度依赖对方给出肯定的回应，对方一犹豫你就更焦虑")

        base = "，".join(filter(None, parts)) + "。"
        if combo:
            base += " " + " ".join(combo)
        return base

    def _format_deep_background(db: dict) -> str:
        if not db:
            return "（无额外背景信息）"
        return "\n".join(f"- {v}" for v in db.values())

    personality = case_data.get("personality", {})
    deep_bg = case_data.get("deep_background", {})

    pi = case_data.get("patient_info", {})
    patient_name = pi.get("name", "患者")
    patient_age = pi.get("age", "")
    patient_gender = pi.get("gender", "")
    parts = [patient_name]
    if patient_age:
        parts.append(f"{patient_age}岁")
    if patient_gender:
        parts.append(patient_gender)
    patient_info_str = "，".join(parts) if len(parts) > 1 else patient_name
    scenario = "你在医院就诊，一位护理学生（请称呼'护士'）正在采集你的病史。请根据你的主诉和现病史如实回答。"

    return {
        "patient_info": patient_info_str or "患者",
        "scenario": scenario,
        "chief_complaint": _get("chief_complaint"),
        "present_illness": _get("present_illness"),
        "past_history": _get("past_history", "无特殊既往史"),
        "medication_history": _get("medication_history", "无长期用药"),
        "allergy_history": _get("allergy_history", "无已知过敏史"),
        "family_history": _get("family_history", "无特殊家族史"),
        "social_history": _get("social_history", "无特殊社会史"),
        "communication_style": _get("communication_style", "用口语化、真实患者的口吻交流。"),
        "personality": _format_personality(personality),
        "deep_background": _format_deep_background(deep_bg),
    }


def format_case_for_prompt(case_data: dict) -> str:
    """将病例数据格式化为 LLM 可读的文本块。"""
    info = case_data.get("patient_info", {})
    lines = [
        f"名称: {case_data.get('name', '')}",
        f"患者: {info.get('name', '')}, {info.get('age', '')}岁, {info.get('gender', '')}",
        f"主诉: {case_data.get('chief_complaint', '')}",
        f"开场白: {case_data.get('opening_line', '')}",
        f"现病史: {case_data.get('present_illness', '')}",
        f"既往史: {case_data.get('past_history', '')}",
        f"用药史: {case_data.get('medication_history', '')}",
        f"过敏史: {case_data.get('allergy_history', '')}",
        f"家族史: {case_data.get('family_history', '')}",
        f"社会史: {case_data.get('social_history', '')}",
        f"沟通风格: {case_data.get('communication_style', '')}",
    ]
    if hidden_info := case_data.get("hidden_info", []):
        lines.append(f"隐藏信息: {'; '.join(hidden_info)}")
    if required := case_data.get("required_inquiries", []):
        lines.append(f"必须采集: {'; '.join(required)}")
    return "\n".join(lines)
