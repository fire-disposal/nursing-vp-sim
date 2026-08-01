"""病例生成提示词——按生成阶段分拆（临床骨架 / 教学衍生）。

两阶段设计（generation.py 配合）：
- core：临床骨架，字段少而核心，质量优先
- derivative：教学衍生字段，以骨架为上下文，强调与主诉/病史的交叉一致性
阶段字段生成（field 模式）复用字段说明，避免重复维护。
"""

# ── 公共头部 ──────────────────────────────────────────────────────────────

_GENERATION_HEAD = """你是一名资深的护理学教育专家和临床病例编写专家。你的任务是根据用户提供的描述，生成一份护理病史采集训练病例。

## 输出格式要求
必须输出**严格的 JSON**（不含 markdown 代码块标记）。
直接输出 JSON，不要任何解释、前言或后记。"""

_GENERATION_TAIL = """
## 用户描述
{#description#}

## 参考资料
{#reference_material#}

## 临床生成指南
1. **真实可信**：症状描述、时间线、流行病学特征需符合临床实际
2. **语言口语化**：opening_line、communication_style、example_dialogues 要有真实患者的口吻
3. **患者信息多样化**：姓名随机生成，年龄与疾病流行病学特征匹配
4. **人格模型**：personality 四维度需根据病例背景设定
5. **评分标准**：评分标准由中央 rubric 管理，病例中不包含 scoring_criteria 字段

{#field_instruction#}"""


# ── 阶段一：临床骨架 ───────────────────────────────────────────────────────

CASE_GENERATION_CORE = (
    _GENERATION_HEAD
    + """

## 本次任务：生成临床骨架

只生成以下字段（缺一不可），JSON 结构：

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
  "personality": {
    "health_literacy": "normal",
    "verbosity": "normal",
    "anxiety_trait": "normal",
    "patience": "normal"
  }
}
```

## 字段说明
- **personality**：四维度控制患者 AI 的角色扮演行为。health_literacy（low/normal/high）、verbosity（terse/normal/verbose）、anxiety_trait（calm/normal/anxious）、patience（low/normal/high）"""
    + _GENERATION_TAIL
)


# ── 阶段二：教学衍生字段 ───────────────────────────────────────────────────

CASE_GENERATION_DERIVATIVE = (
    _GENERATION_HEAD
    + """

## 本次任务：生成教学衍生字段

基于给定的临床骨架（主诉/现病史/既往史等），生成以下字段（缺一不可），JSON 结构：

```json
{
  "hidden_info": ["隐藏信息列表（患者不会主动透露但学生应通过问诊发现的线索）"],
  "required_inquiries": ["必须采集到的关键内容"],
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
- **hidden_info**：3-6 条，患者不便主动告知但影响诊疗的深层背景线索，每条一句话
- **required_inquiries**：4-6 条，每条 5-15 字，覆盖该病例的核心病史采集点。hidden_info 与之对应——学生问到了问诊项才能发现隐藏信息
- **deep_background**：3-6 条，每条一句话。LLM 内部上下文，患者不会主动透露
- **exam_anchors**：护理查体时的预期发现。只需配置与病情匹配的**关键异常体征**（如发热病例给 "temperature": "38.5-39.2"）；其他体征留空，系统会自动按年龄默认值补全并做生理联动（发热→心率代偿↑等）。支持范围格式 "36.8-37.2"
- **example_dialogues**：2-3 组护患典型问答，口语化，体现个性

## 交叉一致性要求
- **exam_anchors 必须与骨架匹配**：主诉咳嗽气促 → 呼吸频率/血氧偏离；发热 → 体温升高；疼痛 → pain_score 偏高。不得与骨架矛盾（如主诉无发热却给高体温）
- **required_inquiries 与 hidden_info 一一对应**：每一条隐藏信息都应能被某条必询项问出
- **deep_background 补充骨架未覆盖的决策因素**：经济、依从性、社会支持等"""
    + _GENERATION_TAIL
)


# ── 字段级生成指令（field 模式） ──────────────────────────────────────────

_FIELD_TYPE_HINTS: dict[str, str] = {
    "hidden_info": "输出为字符串数组，3-6 条，每条一句话",
    "required_inquiries": "输出为字符串数组，4-6 条，每条 5-15 字",
    "deep_background": "输出为对象（键=主题，值=一句话描述），3-6 条",
    "exam_anchors": "输出为对象，含 vital_signs（temperature/heart_rate/blood_pressure/respiratory_rate/spo2）与 skin；只需给关键异常体征",
    "example_dialogues": "输出为数组，每项含 question/answer 两个字段，2-3 组",
    "personality": "输出为对象：health_literacy（low/normal/high）、verbosity（terse/normal/verbose）、anxiety_trait（calm/normal/anxious）、patience（low/normal/high）",
    "patient_info": "输出为对象：name（中文名）、age、gender（男/女）",
    "present_illness": "输出为字符串，描述起病情况、发展经过、诊疗经过",
    "past_history": "输出为字符串，一句既往史概述",
    "medication_history": "输出为字符串，一句用药史概述",
    "allergy_history": "输出为字符串；无过敏史则输出「无」",
    "family_history": "输出为字符串；无相关家族史则输出「无」",
    "social_history": "输出为字符串，一句生活习惯概述",
    "chief_complaint": "输出为字符串，含部位、性质、持续时间、诱因",
    "opening_line": "输出为字符串，患者对护士说的第一句话，口语化",
    "communication_style": "输出为字符串，沟通风格描述",
}


def build_field_instruction(field: str, current_case_data: dict | None) -> str:
    """构建字段级生成指令：类型提示 + 当前病例上下文。"""
    from modules.training.pipeline.prompt_context_builder import format_case_for_prompt

    hint = _FIELD_TYPE_HINTS.get(field, "输出为该字段的合理 JSON 值")
    inst = f'\n\n当前任务：只生成字段「{field}」。{hint}。输出 JSON 形如 {{"{field}": <值>}}。'
    if current_case_data:
        inst += f"\n\n当前病例上下文：\n{format_case_for_prompt(current_case_data)}"
    return inst


def build_system_prompt(
    stage: str,
    description: str,
    reference_material: str,
    field_instruction: str,
) -> str:
    """按生成阶段拼接系统提示词。"""
    template = CASE_GENERATION_DERIVATIVE if stage == "derivative" else CASE_GENERATION_CORE
    return (
        template.replace("{#description#}", description)
        .replace("{#reference_material#}", reference_material)
        .replace("{#field_instruction#}", field_instruction)
    )
