"""虚拟患者提示词构建服务 — AI酒馆风格的消息组装

职责：
- build_patient_context_kwargs: 从 case_data 提取10个模板变量
- build_patient_chat_messages: 组装 messages 数组（含缓存分片 + Author's Note 注入）
- format_case_for_prompt: 将病例 JSON 格式化为 LLM 可读文本
"""

import logging

log = logging.getLogger(__name__)

from infrastructure.prompt import render_template
from prompts.patient_chat import AUTHOR_NOTE_TEMPLATE


def build_patient_context_kwargs(
    case_data: dict,
    author_note: str = "",
) -> dict[str, str]:
    """从 case_data 构建 10 个模板变量。"""

    def _get(key: str, default: str = "无") -> str:
        return str(case_data.get(key, "")).strip() or default

    def _format_personality(p: dict) -> str:
        if not p:
            return "普通患者，正常配合。"
        parts = []
        lit = {
            "low": "不太会描述病情，用词简单模糊，听不懂专业术语需要护士用大白话解释",
            "normal": "能正常描述症状，常见医学词汇能听懂，太专业的还是不明白",
            "high": "能精准描述病情感受，理解大部分医学术语，自己偶尔也用专业词汇（可能从事过医疗相关工作或久病成医）",
        }
        verb = {"terse": "寡言少语，问一句答一句，不主动多说", "normal": "正常交流", "verbose": "话多健谈，容易跑题"}
        anx = {"calm": "心态平和，不太担心", "normal": "适度担心病情", "anxious": "容易焦虑，常反问'严不严重'"}
        pat = {"low": "耐心不足，问多了容易急躁", "normal": "有耐心配合", "high": "非常耐心，愿意详细回答"}
        for key, mapping in [("health_literacy", lit), ("verbosity", verb), ("anxiety_trait", anx), ("patience", pat)]:
            if p.get(key):
                parts.append(mapping.get(p[key], ""))
        return "，".join(filter(None, parts)) + "。"

    def _format_deep_background(db: dict) -> str:
        if not db:
            return "（无额外背景信息）"
        lines = []
        for key, value in db.items():
            lines.append(f"- {value}")
        return "\n".join(lines)

    def _format_example_dialogues(examples: list) -> str:
        if not examples:
            return "（无示例对话，按性格自由发挥）"
        lines = []
        for ex in examples[:3]:
            q = ex.get("question", "")
            a = ex.get("answer", "")
            if q and a:
                lines.append(f"护士问：{q}")
                lines.append(f"你回答：{a}\n")
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

    return {
        "patient_info": patient_info_str or "未知患者",
        "scenario": scenario,
        "chief_complaint": _get("chief_complaint"),
        "present_illness": _get("present_illness"),
        "allergy_history": _get("allergy_history", "无已知过敏史"),
        "communication_style": _get("communication_style", "用口语化、真实患者的口吻交流。"),
        "personality": _format_personality(personality),
        "deep_background": _format_deep_background(deep_bg),
        "example_dialogues": _format_example_dialogues(examples),
        "author_note": author_note if author_note.strip() else "",
    }


def build_patient_chat_messages(
    system_prompt: str,
    dynamic_prompt: str,
    history_messages: list,
    student_content: str,
    author_note: str = "",
    max_rounds: int = 8,
) -> list[dict]:
    """构建 AI酒馆风格的 messages 数组。

    结构：
      messages[0] = Character Card (静态, prefix cache)
      messages[1] = 患者资料+背景+示例 (per-session)
      messages[2..N] = 聊天历史
      messages[-2] = 用户输入
      messages[-1] = Author's Note (系统消息, 放在用户输入之后，提升 KV cache 命中率)
    """
    llm_messages = [
        {"role": "system", "content": system_prompt},
        {"role": "system", "content": dynamic_prompt},
    ]

    for msg in history_messages[-max_rounds * 2 :]:
        if msg.role == "system":
            continue
        role = "user" if msg.role == "student" else "assistant"
        llm_messages.append({"role": role, "content": msg.content})

    llm_messages.append({"role": "user", "content": student_content})

    if author_note.strip():
        note_content = render_template(AUTHOR_NOTE_TEMPLATE, author_note=author_note)
        llm_messages.append({"role": "system", "content": note_content})

    return llm_messages


def format_case_for_prompt(case_data: dict) -> str:
    """将病例数据格式化为 LLM 可读的文本块，用于病例生成等场景的上下文"""
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
