"""History taking context kwargs builder — extracts template variables from case_data."""

import logging

log = logging.getLogger(__name__)


def build_context_kwargs(case_data: dict, author_note: str = "") -> dict[str, str]:
    """从 case_data 构建该 profile 的模板变量字典。"""
    from contexts.patient.prompt import AUTHOR_NOTE_TEMPLATE
    from infrastructure.prompt import render_template

    def _get(key: str, default: str = "无") -> str:
        return str(case_data.get(key, "")).strip() or default

    def _format_personality(p: dict) -> str:
        if not p:
            return "普通患者，正常配合。"
        parts = []
        lit = {
            "low": "不太会描述病情，用词简单模糊",
            "normal": "能正常描述症状",
            "high": "能精准描述病情感受",
            "medium": "能正常描述症状",
        }
        verb = {"terse": "寡言少语", "normal": "正常交流", "verbose": "话多健谈"}
        anx = {"calm": "心态平和", "normal": "适度担心", "anxious": "容易焦虑"}
        pat = {"low": "耐心不足", "normal": "有耐心配合", "high": "非常耐心"}
        for key, mapping in [("health_literacy", lit), ("verbosity", verb), ("anxiety_trait", anx), ("patience", pat)]:
            if p.get(key):
                parts.append(mapping.get(p[key], ""))
        return "，".join(filter(None, parts)) + "。"

    def _format_deep_background(db: dict) -> str:
        if not db:
            return "（无额外背景信息）"
        return "\n".join(f"- {v}" for v in db.values())

    def _format_example_dialogues(examples: list) -> str:
        if not examples:
            return "（无示例对话，按性格自由发挥）"
        lines = []
        for ex in examples[:3]:
            q, a = ex.get("question", ""), ex.get("answer", "")
            if q and a:
                lines.extend([f"护士问：{q}", f"你回答：{a}\n"])
        return "\n".join(lines) if lines else "（按性格自由发挥）"

    personality = case_data.get("personality", {})
    deep_bg = case_data.get("deep_background", {})
    examples = case_data.get("example_dialogues", [])

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
    scenario = f"你在医院就诊，一位护理学生（请称呼'护士'）正在采集你的病史。{_get('opening_line', '你今天来医院是因为身体不舒服。')}"

    kwargs = {
        "patient_info": patient_info_str or "未知患者",
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
        "example_dialogues": _format_example_dialogues(examples),
    }

    if author_note.strip():
        rendered = render_template(AUTHOR_NOTE_TEMPLATE, author_note=author_note)
        kwargs["author_note"] = rendered
    else:
        kwargs["author_note"] = ""

    return kwargs


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
