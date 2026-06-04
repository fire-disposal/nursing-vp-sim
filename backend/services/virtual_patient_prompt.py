"""虚拟患者提示词构建服务 —— 从业务数据组装 LLM messages 数组

职责：
- build_patient_context_kwargs: 从 case_data 提取模板渲染所需的 6 个变量值
- build_patient_chat_messages: 组装 OpenAI-compatible messages 列表（含缓存分片）
- format_case_for_prompt: 将病例 JSON 格式化为 LLM 可读的文本块
"""

# 缓存分片标记：模板中患者资料区块的标题行，运行时以此为界拆分 messages
_CACHE_SPLIT_MARKER = "## 患者资料"


def build_patient_context_kwargs(case_data: dict, allowed_hidden_info: list[dict] | None = None) -> dict:
    """从病例数据构建患者对话模板的渲染变量。

    返回 6 个键：communication_style, patient_info, chief_complaint,
    present_illness, allergy_history, hidden_info_rules。
    支持 VariableRegistry 默认值回退，确保模板变量始终有值。
    """
    from services.variable_registry import get_registry

    defaults = get_registry().get_defaults("patient_chat")

    pi = case_data.get("patient_info", {})
    patient_info_str = f"{pi.get('name', '患者')}，{pi.get('age', '')}岁，{pi.get('gender', '')}"

    hidden_items = []
    for detail in allowed_hidden_info or []:
        if detail.get("triggered"):
            hidden_items.append(f"- {detail.get('content', detail)}")
    hidden_info_rules = "\n".join(hidden_items) if hidden_items else "暂无额外信息"

    return {
        "communication_style": str(
            case_data.get("communication_style") or defaults.get("communication_style", "友善自然")
        ),
        "patient_info": patient_info_str or defaults.get("patient_info", ""),
        "chief_complaint": str(case_data.get("chief_complaint") or defaults.get("chief_complaint", "未知")),
        "present_illness": str(case_data.get("present_illness") or defaults.get("present_illness", "未知")),
        "allergy_history": str(case_data.get("allergy_history") or defaults.get("allergy_history", "无")),
        "hidden_info_rules": hidden_info_rules or defaults.get("hidden_info_rules", ""),
    }


def build_patient_chat_messages(
    system_prompt: str,
    history_messages: list,
    student_content: str,
    max_rounds: int = 8,
) -> list[dict]:
    """构建 OpenAI-compatible messages 数组。

    缓存分片策略：
      messages[0] = 静态行为规则（`## 患者资料` 之前的全部内容）
        → DeepSeek prefix cache 全局复用，跨所有会话、所有病例共享
      messages[1] = 患者数据 + 隐藏信息（`## 患者资料` 及之后的内容）
        → 按会话/每轮消息更新，仅 ~200 token

    向后兼容：若模板不含 `## 患者资料` 标记，整个 prompt 放在 messages[0]。
    messages[后续] = 最近 N 轮历史（student→user, patient→assistant）
    messages[-1] = 学生当前输入
    """
    idx = system_prompt.find(_CACHE_SPLIT_MARKER)
    if idx != -1:
        static_prefix = system_prompt[:idx].rstrip()
        patient_block = system_prompt[idx:].strip()
        llm_messages = [
            {"role": "system", "content": static_prefix},
            {"role": "system", "content": patient_block},
        ]
    else:
        llm_messages = [{"role": "system", "content": system_prompt}]

    for msg in history_messages[-max_rounds * 2 :]:
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
