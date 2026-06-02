"""虚拟患者提示词构建服务 —— 从业务数据组装 LLM messages 数组

职责：
- build_patient_context_kwargs: 从 case_data 提取模板渲染所需的 6 个变量值
- build_patient_chat_messages: 组装 OpenAI-compatible messages 列表
"""


def build_patient_context_kwargs(case_data: dict,
                                 allowed_hidden_info: list[dict] | None = None) -> dict:
    """从病例数据构建患者对话模板的渲染变量。

    返回 6 个键：communication_style, patient_info, chief_complaint,
    present_illness, allergy_history, hidden_info_rules。
    支持 VariableRegistry 默认值回退，确保模板变量始终有值。
    """
    from services.variable_registry import get_registry
    defaults = get_registry().get_defaults("patient_chat")

    pi = case_data.get("patient_info", {})
    patient_info_str = (
        f"{pi.get('name', '患者')}，{pi.get('age', '')}岁，{pi.get('gender', '')}"
    )

    hidden_items = []
    for detail in (allowed_hidden_info or []):
        if detail.get("triggered"):
            hidden_items.append(f"- {detail.get('content', detail)}")
    hidden_info_rules = "\n".join(hidden_items) if hidden_items else "暂无额外信息"

    return {
        "communication_style": str(case_data.get("communication_style") or defaults.get("communication_style", "友善自然")),
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

    messages[0] = system prompt（position=0 对 DeepSeek 前缀缓存最友好）
    messages[1 : 1 + max_rounds*2] = 最近 N 轮历史（student→user, patient→assistant）
    messages[-1] = 学生当前输入
    """
    llm_messages = [{"role": "system", "content": system_prompt}]

    for msg in history_messages[-max_rounds * 2:]:
        role = "user" if msg.role == "student" else "assistant"
        llm_messages.append({"role": role, "content": msg.content})

    llm_messages.append({"role": "user", "content": student_content})
    return llm_messages
