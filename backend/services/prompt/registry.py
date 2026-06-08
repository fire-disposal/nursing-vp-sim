"""集中管理所有 prompt purpose 的合法变量定义"""

from dataclasses import dataclass


@dataclass
class VariableDef:
    name: str
    type: str = "string"
    description: str = ""
    source: str = ""
    required: bool = True
    default_example: str = ""


_REGISTRY: dict[str, list[VariableDef]] = {
    "patient_dynamic": [
        VariableDef(
            name="chief_complaint",
            type="string",
            description="主诉",
            source="病例数据 > chief_complaint",
            default_example="咳嗽咳痰3天",
        ),
        VariableDef(
            name="present_illness",
            type="string",
            description="现病史",
            source="病例数据 > present_illness",
            default_example="患者3天前受凉后出现咳嗽",
        ),
        VariableDef(
            name="allergy_history",
            type="string",
            description="过敏史",
            source="病例数据 > allergy_history",
            default_example="无",
        ),
        VariableDef(
            name="deep_background",
            type="text",
            description="患者深度背景（吸烟史、职业暴露等），始终可用",
            source="病例数据 > deep_background",
            default_example="- 30年吸烟史\n- 建筑工人",
        ),
        VariableDef(
            name="example_dialogues",
            type="text",
            description="参考对话示例（护士问→患者答），LLM 模仿此风格",
            source="病例数据 > example_dialogues 格式化",
            default_example="护士问：您哪里不舒服？\n你回答：咳得厉害...",
        ),
    ],
    "patient_chat": [
        VariableDef(
            name="patient_info",
            type="string",
            description="患者姓名、年龄、性别",
            source="病例数据 > patient_info 拼接",
            default_example="张三，45岁，男",
        ),
        VariableDef(
            name="scenario",
            type="text",
            description="当前对话场景描述（就诊情境）",
            source="病例数据 > opening_line + 固定模板",
            default_example="你在医院就诊，一位护理学生在采集你的病史。",
        ),
        VariableDef(
            name="personality",
            type="text",
            description="患者人格描述（健康素养、健谈程度、焦虑倾向、耐心）",
            source="病例数据 > personality 格式化",
            default_example="能正常描述，正常交流，适度担心，有耐心。",
        ),
        VariableDef(
            name="communication_style",
            type="string",
            description="患者沟通风格描述",
            source="病例数据 > communication_style",
            default_example="友善自然，略带焦虑",
        ),
        VariableDef(
            name="chief_complaint",
            type="string",
            description="主诉",
            source="病例数据 > chief_complaint",
            default_example="咳嗽咳痰3天",
        ),
        VariableDef(
            name="present_illness",
            type="string",
            description="现病史",
            source="病例数据 > present_illness",
            default_example="患者3天前受凉后出现咳嗽",
        ),
        VariableDef(
            name="allergy_history",
            type="string",
            description="过敏史",
            source="病例数据 > allergy_history",
            default_example="无",
        ),
        VariableDef(
            name="deep_background",
            type="text",
            description="患者深度背景（吸烟史、职业暴露等），始终可用",
            source="病例数据 > deep_background",
            default_example="- 30年吸烟史\n- 建筑工人",
        ),
        VariableDef(
            name="example_dialogues",
            type="text",
            description="参考对话示例（护士问→患者答），LLM 模仿此风格",
            source="病例数据 > example_dialogues 格式化",
            default_example="护士问：您哪里不舒服？\n你回答：咳得厉害...",
        ),
        VariableDef(
            name="author_note",
            type="text",
            description="每轮动态注入的当前状态提示（情绪/操作/事件）",
            source="运行时由情绪引擎计算",
            default_example="【当前: 患者正常配合...】",
        ),
    ],
    "scoring": [
        VariableDef(
            name="scoring_criteria",
            type="text",
            description="评分标准维度、条目及1-3分评分锚点",
            source="data/rubrics/nursing_history_v1.json + build_scoring_criteria() 自动生成",
            default_example=(
                "## 评分标准版本\n"
                "护理病史采集训练评分标准 v1.0（原始57分制，每项1-3分，系统将自动换算为100分制）\n\n"
                "## 评估维度与条目\n\n"
                "### 沟通技能（14项，满分42分）\n"
                "3分: 主动礼貌问候 / 2分: 有简单问候 / 1分: 未问候\n"
                "...（共19项评分条目）"
            ),
        ),
        VariableDef(
            name="required_inquiries",
            type="text",
            description="病例中必须采集到的关键内容清单（JSON数组格式）",
            source="病例数据 > required_inquiries",
            default_example='[\n  "主诉（部位、性质、持续时间）",\n  "现病史（起病、发展、诊疗）",\n  "既往史",\n  "过敏史"\n]',
        ),
        VariableDef(
            name="scoring_json_schema",
            type="text",
            description="LLM 评分结果输出的 JSON 格式模板",
            source="rubrics/nursing_history_v1.json + build_scoring_json_schema() 自动生成",
            default_example=(
                "## 输出格式\n\n必须是严格的 JSON：\n\n"
                '{\n  "rubric_version": "nursing_history_v1@1.0",\n'
                '  "total_score": 数字(满分57),\n'
                '  "detail_scores": {\n    "沟通技能": {...},\n    "病史采集": {...}\n  },\n'
                '  "strengths": [...], "weaknesses": [...],\n'
                '  "missed_content": [...], "suggestions": "..."\n}'
            ),
        ),
        VariableDef(
            name="scoring_rubric",
            type="text",
            description="[已废弃] 完整评分标准文本（含标准+清单+输出格式）。请改用 scoring_criteria / required_inquiries / scoring_json_schema 三个独立变量",
            source="[已废弃] prompt_static.build_scoring_rubric()",
            required=False,
            default_example="(已废弃，请使用分拆后的三个独立变量)",
        ),
        VariableDef(
            name="conversation_text",
            type="text",
            description="学生与虚拟患者的完整对话记录",
            source="Message 表该训练记录的所有消息拼接",
            default_example="学生：你好，请问你哪里不舒服？\n\n患者：我最近咳嗽得厉害...",
        ),
    ],
    "scoring_feedback": [
        VariableDef(
            name="scoring_criteria",
            type="text",
            description="评分标准维度、条目及1-3分评分锚点",
            source="data/rubrics/nursing_history_v1.json + build_scoring_criteria()",
            default_example="(同 scoring 的 scoring_criteria)",
        ),
        VariableDef(
            name="required_inquiries",
            type="text",
            description="病例中必须采集到的关键内容清单（JSON数组格式）",
            source="病例数据 > required_inquiries",
            default_example='["主诉", "现病史", "既往史", "过敏史"]',
        ),
        VariableDef(
            name="scoring_result",
            type="text",
            description="已完成评分的完整 JSON 结果（含 total_score 和 detail_scores）",
            source="第一阶段评分 LLM 输出",
            default_example='{"total_score": 42, "detail_scores": {...}}',
        ),
        VariableDef(
            name="conversation_text",
            type="text",
            description="学生与虚拟患者的完整对话记录",
            source="Message 表该训练记录的所有消息拼接",
            default_example="学生：你好，请问你哪里不舒服？\n\n患者：我最近咳嗽得厉害...",
        ),
    ],
    "case_generation": [
        VariableDef(
            name="description",
            type="string",
            description="教师输入的病例生成需求描述",
            source="教师输入 > CaseGenerateRequest.description",
            default_example="生成一个关于高血压患者的病史采集训练病例",
        ),
        VariableDef(
            name="reference_material",
            type="text",
            description="参考病例数据或补充文本",
            source="教师选择的参考病例 + 补充文本",
            default_example="参考病例：患者因高血压入院...",
        ),
    ],
    "qa": [],
}


class VariableRegistry:
    """集中管理所有 purpose 的合法变量定义"""

    def get_variables(self, purpose: str) -> list[VariableDef]:
        """返回某 purpose 的所有变量定义"""
        return _REGISTRY.get(purpose, [])

    def get_variable_names(self, purpose: str) -> set[str]:
        """返回某 purpose 的变量名集合"""
        return {v.name for v in self.get_variables(purpose)}

    def get_variable_map(self, purpose: str) -> dict[str, VariableDef]:
        """返回 {name: VariableDef} 映射"""
        return {v.name: v for v in self.get_variables(purpose)}

    def validate_template_vars(self, purpose: str, template_vars: set[str]) -> tuple[list[str], list[str]]:
        """校验模板中使用的变量是否在注册表中。
        返回 (errors, warnings)。errors 表示硬阻断，warnings 表示建议但允许通过。
        未知变量产生 warning，不阻断——允许管理员实验性地添加新变量（如未来的 personality_type）。
        仅当 purpose 为 qa（调用点完全不传变量值）时，任何变量都产生 error。"""
        known = self.get_variable_names(purpose)
        unknown = template_vars - known
        errors: list[str] = []
        warnings: list[str] = []

        if unknown:
            msg = f"未识别的变量: {', '.join(sorted(unknown))}"
            if purpose == "qa":
                errors.append(f"{msg}（QA 模板不支持变量，调用点不传任何变量值）")
            else:
                known_display = ", ".join(sorted(known)) if known else "无"
                warnings.append(
                    f"{msg}。这些变量不会被运行时填充，请确认调用点已提供对应值。"
                    f"（{purpose} 已知变量: {known_display}）"
                )

        return errors, warnings

    def get_sample_kwargs(self, purpose: str) -> dict[str, str]:
        """获取某 purpose 的示例变量值，供预览使用。
        scoring_criteria / scoring_json_schema 特殊处理：调用 build 函数动态生成。"""
        result: dict[str, str] = {}
        for v in self.get_variables(purpose):
            if v.name == "scoring_criteria":
                from services.prompt.static import build_scoring_criteria

                result[v.name] = build_scoring_criteria()
            elif v.name == "scoring_json_schema":
                from services.prompt.static import build_scoring_json_schema

                result[v.name] = build_scoring_json_schema()
            elif v.name == "scoring_rubric":
                from services.prompt.static import build_scoring_rubric

                result[v.name] = build_scoring_rubric()
            else:
                result[v.name] = v.default_example
        return result

    def get_variables_jsonb(self, purpose: str) -> list[dict]:
        """返回适合存入 PromptTemplate.variables JSONB 的变量元数据列表"""
        return [
            {
                "name": v.name,
                "desc": v.description,
                "source": v.source,
                "type": v.type,
                "example": v.default_example,
            }
            for v in self.get_variables(purpose)
        ]

    def get_defaults(self, purpose: str) -> dict[str, str]:
        """返回某 purpose 所有变量的 default_example 映射"""
        return {v.name: v.default_example for v in self.get_variables(purpose)}


_registry = VariableRegistry()


def get_registry() -> VariableRegistry:
    return _registry
