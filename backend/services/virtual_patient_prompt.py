"""虚拟患者提示词构建服务 —— 从业务数据组装 LLM messages 数组

职责：
- build_patient_context_kwargs: 从 case_data 提取8个模板变量
- build_patient_chat_messages: 组装 OpenAI-compatible messages 列表（含缓存分片）
- format_case_for_prompt: 将病例 JSON 格式化为 LLM 可读的文本块
"""

import logging

log = logging.getLogger(__name__)

from prompts.patient_chat import PATIENT_CACHE_SPLIT_MARKER


def build_patient_context_kwargs(
    case_data: dict,
    author_note: str = "",
) -> dict[str, str]:
    """从 case_data 构建患者 prompt 的 8 个模板变量。"""

    def _get(key: str, default: str = "无") -> str:
        return str(case_data.get(key, "")).strip() or default

    def _format_personality(p: dict) -> str:
        if not p:
            return "普通患者，正常配合。"
        parts = []
        lit = {"low": "不太会描述病情", "normal": "能正常描述", "high": "能精准描述"}
        verb = {"terse": "寡言少语，问一句答一句", "normal": "正常交流", "verbose": "话多，容易跑题"}
        anx = {"calm": "心态平和", "normal": "适度担心", "anxious": "容易焦虑，常反问病情严重程度"}
        pat = {"low": "耐心不足，容易急躁", "normal": "有耐心", "high": "非常耐心"}
        if p.get("health_literacy"):
            parts.append(lit.get(p["health_literacy"], ""))
        if p.get("verbosity"):
            parts.append(verb.get(p["verbosity"], ""))
        if p.get("anxiety_trait"):
            parts.append(anx.get(p["anxiety_trait"], ""))
        if p.get("patience"):
            parts.append(pat.get(p["patience"], ""))
        return "，".join(filter(None, parts)) + "。"

    def _format_deep_background(db: dict) -> str:
        if not db:
            return "（无额外背景）"
        lines = []
        for key, value in db.items():
            lines.append(f"- {key}: {value}")
        return "\n".join(lines)

    personality = case_data.get("personality", {})
    deep_bg = case_data.get("deep_background", {})

    pi = case_data.get("patient_info", {})
    patient_info_str = f"{pi.get('name', '患者')}，{pi.get('age', '')}岁，{pi.get('gender', '')}"

    return {
        "patient_info": patient_info_str or "未知患者",
        "chief_complaint": _get("chief_complaint"),
        "present_illness": _get("present_illness"),
        "allergy_history": _get("allergy_history", "无已知过敏史"),
        "communication_style": _get("communication_style", "用口语化、真实患者的口吻交流。"),
        "personality": _format_personality(personality),
        "deep_background": _format_deep_background(deep_bg),
        "author_note": author_note if author_note.strip() else "（常规状态，正常配合）",
    }


def build_patient_chat_messages(
    system_prompt: str,
    history_messages: list,
    student_content: str,
    max_rounds: int = 8,
) -> list[dict]:
    """构建 OpenAI-compatible messages 数组。

    缓存分片策略：
      messages[0] = 静态行为规则（PATIENT_CACHE_SPLIT_MARKER 之前的全部内容）
        → DeepSeek prefix cache 全局复用
      messages[1] = 背景/性格/当前状态（PATIENT_CACHE_SPLIT_MARKER 及之后）
        → 按会话更新，~200 token
    """
    idx = system_prompt.find(PATIENT_CACHE_SPLIT_MARKER)
    if idx != -1:
        static_prefix = system_prompt[:idx].rstrip()
        dynamic_part = system_prompt[idx:].strip()
        llm_messages = [
            {"role": "system", "content": static_prefix},
            {"role": "system", "content": dynamic_part},
        ]
    else:
        llm_messages = [{"role": "system", "content": system_prompt}]

    for msg in history_messages[-max_rounds * 2:]:
        role = "user" if msg.role == "student" else "assistant"
        llm_messages.append({"role": role, "content": msg.content})

    llm_messages.append({"role": "user", "content": student_content})
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
