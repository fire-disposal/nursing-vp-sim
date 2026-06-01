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
    "patient_chat": [
        VariableDef(
            name="communication_style",
            type="string",
            description="患者的沟通风格描述，如'友善自然，略带焦虑'",
            source="病例数据 > communication_style",
            default_example="友善自然，略带焦虑",
        ),
        VariableDef(
            name="patient_info",
            type="string",
            description="患者基本信息，格式为'姓名，年龄岁，性别'",
            source="病例数据 > patient_info 拼接",
            default_example="张三，45岁，男",
        ),
        VariableDef(
            name="chief_complaint",
            type="string",
            description="主诉（含部位、性质、持续时间、诱因）",
            source="病例数据 > chief_complaint",
            default_example="咳嗽咳痰3天",
        ),
        VariableDef(
            name="present_illness",
            type="string",
            description="现病史（起病情况、发展经过、诊疗经过）",
            source="病例数据 > present_illness",
            default_example="患者3天前受凉后出现咳嗽，伴少量白痰",
        ),
        VariableDef(
            name="allergy_history",
            type="string",
            description="过敏史",
            source="病例数据 > allergy_history",
            default_example="无",
        ),
        VariableDef(
            name="hidden_info_rules",
            type="text",
            description="本轮可透露的隐藏信息，根据学生消息动态计算",
            source="运行时根据学生触发关键词动态生成",
            default_example="- 关于咯血：最近一周痰中带血丝，量不多",
        ),
    ],
    "scoring": [
        VariableDef(
            name="scoring_criteria",
            type="text",
            description="评分标准维度、条目及1-3分评分锚点",
            source="rubrics/nursing_history_v1.json + build_scoring_criteria() 自动生成",
            default_example="(由 build_scoring_criteria 动态生成)",
        ),
        VariableDef(
            name="required_inquiries",
            type="text",
            description="病例中必须采集到的关键内容清单（JSON数组格式）",
            source="病例数据 > required_inquiries",
            default_example='[\n  "主诉详情",\n  "现病史详情"\n]',
        ),
        VariableDef(
            name="scoring_json_schema",
            type="text",
            description="LLM 评分结果输出的 JSON 格式模板",
            source="rubrics/nursing_history_v1.json + build_scoring_json_schema() 自动生成",
            default_example="(由 build_scoring_json_schema 动态生成)",
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
                from prompt_static import build_scoring_criteria
                result[v.name] = build_scoring_criteria()
            elif v.name == "scoring_json_schema":
                from prompt_static import build_scoring_json_schema
                result[v.name] = build_scoring_json_schema()
            elif v.name == "scoring_rubric":
                from prompt_static import build_scoring_rubric
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
