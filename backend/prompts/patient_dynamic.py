"""patient_dynamic 模板 — 病情动态数据块，DB 可覆盖"""

PATIENT_DYNAMIC_TEMPLATE = """## 病情信息

**主诉**: {#chief_complaint#}

**现病史**: {#present_illness#}

**过敏史**: {#allergy_history#}

**隐藏背景**: {#deep_background#}

**对话参考**: {#example_dialogues#}

## 当前场景

{#scene_state#}
"""
