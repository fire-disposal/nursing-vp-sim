"""病例 → 作者/生成面可读文本块（纯函数）。

消费者是**病例生成**（骨架、参考病例、字段级重生成），不是患者扮演：这里输出的是
给作者侧 LLM 看的病例摘要（含隐藏信息与必须采集项），不得进入学生可见对话。
患者扮演的模板变量见 ``modules/training/context/case_vars.py``。
"""

from __future__ import annotations


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
