"""病例生成提示词——按训练类型分拆，不再使用条件变量占位符。"""

CASE_GENERATION_HEAD = """你是一名资深的护理学教育专家和临床病例编写专家。你的任务是根据用户提供的描述，生成一份完整的{#training_type_label#}训练病例。

## 输出格式要求
必须输出**严格的 JSON**（不含 markdown 代码块标记），结构如下：

```json
{
  "name": "病例名称（20字以内，基于主诉概括）",
  "difficulty": 1,
  "time_limit": 20,
  "description": "训练目标描述（一句话）",
  "patient_info": {"name": "患者姓名（中文名）", "age": 0, "gender": "男/女"},
  "chief_complaint": "主诉（含部位、性质、持续时间、诱因）",
  "opening_line": "开场白（患者对护士说的第一句话，口语化）",
  "present_illness": "现病史（起病情况、发展经过、诊疗经过）",
  "past_history": "既往史",
  "medication_history": "用药史",
  "allergy_history": "过敏史",
  "family_history": "家族史",
  "social_history": "社会史/生活习惯",
  "communication_style": "沟通风格描述（友善自然/紧张焦虑/含糊其辞+细节）",
  "hidden_info": ["隐藏信息列表（患者不会主动透露但学生应通过问诊发现的线索）"],
  "required_inquiries": ["必须采集到的关键内容"],
  "rubric_ref": "active",
  "personality": {
    "health_literacy": "normal",
    "verbosity": "normal",
    "anxiety_trait": "normal",
    "patience": "normal"
  },
  "deep_background": {
    "吸烟史": "吸烟30年，每日1包",
    "职业": "退休工人",
    "用药顾虑": "因经济原因自行减少药量"
  },
  "exam_anchors": {
    "vital_signs": {
      "temperature": "36.8",
      "heart_rate": "76",
      "blood_pressure": "125/82",
      "respiratory_rate": "18",
      "spo2": "98"
    },
    "skin": "皮肤温暖干燥，未见皮疹"
  },
  "example_dialogues": [
    {"question": "护士的典型问题", "answer": "患者的口语化回答"}
  ]
}
```

## 字段说明
- **personality**：四维度控制患者 AI 的角色扮演行为。health_literacy（low/normal/high）、verbosity（terse/normal/verbose）、anxiety_trait（calm/normal/anxious）、patience（low/normal/high）
- **deep_background**：患者不便主动告知但影响诊疗的深层背景。3-6 条，每条一句话
- **exam_anchors**：护理查体时的预期发现。使用固定值（如 `"temperature": "36.8"`），系统会在显示时做微小随机偏移
- **example_dialogues**：2-3 组护患典型问答，口语化，体现个性"""

CASE_GENERATION_TRIAGE_EXTRA = """
## 分诊病例额外输出字段
分诊病例须额外包含以下字段：
- **arrival_mode**: 患者到达方式（"ambulance"/"stretcher"/"walking"）
- **vitals**: 生命体征对象（hr/bp_sys/bp_dia/rr/spo2/temp）
- **consciousness**: 意识状态（"alert"/"lethargic"/"confused"/"unresponsive"）
- **red_flags**: 警示信号数组
- **mews_score**: 默认填 0（由学生评估后填写）
"""

CASE_GENERATION_TAIL = """
## 用户描述
{#description#}

## 参考资料
{#reference_material#}

## 临床生成指南
1. **真实可信**：症状描述、时间线、流行病学特征需符合临床实际
2. **教育价值**：hidden_info 和 required_inquiries 适合护理学生训练
3. **评分标准**：评分标准由中央 rubric 管理，病例中不包含 scoring_criteria 字段
4. **语言口语化**：opening_line、communication_style、example_dialogues 要有真实患者的口吻
5. **患者信息多样化**：姓名随机生成，年龄与疾病流行病学特征匹配
6. **人格模型**：personality 四维度需根据病例背景设定
7. **深层背景**：deep_background 补充影响诊疗决策的隐蔽信息
8. **查体锚点**：exam_anchors.vital_signs 给出与病情匹配的生命体征范围
9. **示例对话**：example_dialogues 提供 2-3 组护患问答

{#field_instruction#}

直接输出 JSON，不要任何解释、前言或后记。"""


def build_system_prompt(
    training_type: str,
    training_type_label: str,
    description: str,
    reference_material: str,
    field_instruction: str,
) -> str:
    """按训练类型拼接系统提示词，避免模板内嵌条件变量。"""
    parts = [CASE_GENERATION_HEAD]
    if training_type == "triage":
        parts.append(CASE_GENERATION_TRIAGE_EXTRA)
    parts.append(CASE_GENERATION_TAIL)
    return "\n\n".join(parts)
