"""build_final_rubric — 纯函数：基础 rubric + 护理记录维度动态追加，返回最终 rubric 深拷贝。

原则：不修改入参，返回新的 rubric dict，调用方可安全使用。
"""

from copy import deepcopy

_NURSING_RECORD_DIMENSION = {
    "id": "nursing_record",
    "name": "护理记录",
    "max": 15,
    "description": "评估护理评估记录（ADPIE）的完整性与合理性",
    "items": [
        {
            "id": "nr_01",
            "name": "护理评估记录的完整性和结构性",
            "anchors": {
                "3": "五步齐全(主观/客观/评估/计划/评价)，每个部分内容充实",
                "2": "多数步骤已填写但部分缺失或内容过简",
                "1": "未填写护理记录或内容严重缺失",
            },
        },
        {
            "id": "nr_02",
            "name": "护理评估的临床合理性与专业性",
            "anchors": {
                "3": "评估具有逻辑性，护理诊断与采集的病史数据一致，方案具有针对性",
                "2": "评估基本合理但部分环节存在逻辑偏差或方案泛化",
                "1": "评估缺乏逻辑性或严重脱离病史采集内容",
            },
        },
        {
            "id": "nr_03",
            "name": "护理记录内容真实反映对话中的客观证据",
            "anchors": {
                "3": "主客观数据准确反映对话中的患者陈述和查体结果，无编造",
                "2": "大部分数据来自对话，但存在少量不准确或推断性表述",
                "1": "护理记录存在大量编造或与对话内容明显矛盾的数据",
            },
        },
        {
            "id": "nr_04",
            "name": "护理问题优先级排序与措施针对性",
            "anchors": {
                "3": "识别出患者的主要护理问题并按优先级排序，措施具体可行",
                "2": "护理问题识别基本正确但排序不够合理，措施过于泛化",
                "1": "未识别关键护理问题或措施与问题不匹配",
            },
        },
        {
            "id": "nr_05",
            "name": "评价环节的反思深度",
            "anchors": {
                "3": "评价体现对措施效果的批判性反思，提出后续跟进建议",
                "2": "有简单的效果评价但缺乏深入反思",
                "1": "无评价环节或评价填空性质不反映实际思考",
            },
        },
    ],
}


def build_final_rubric(base_rubric: dict, features: dict | None = None) -> dict:
    """返回最终评分 rubric（深拷贝，不修改入参）。

    Args:
        base_rubric: profile.rubric 或 load_rubric() 返回的基准 rubric dict
        features: resolve_features 后的能力开关 dict（检查 nursing_record 键）

    Returns:
        深拷贝后的 rubric dict；若 nursing_record 开启则追加护理记录维度并调高 raw_max
    """
    # [DISABLED] 护理评估记录评分暂时禁用
    # 恢复时取消下方注释：
    # rubric = deepcopy(base_rubric)
    # if features and features.get("nursing_record"):
    #     existing_ids = {d.get("id") for d in rubric.get("dimensions", [])}
    #     if "nursing_record" not in existing_ids:
    #         rubric.setdefault("dimensions", []).append(deepcopy(_NURSING_RECORD_DIMENSION))
    #         rubric["raw_max"] = rubric.get("raw_max", 57) + 15
    # return rubric
    return deepcopy(base_rubric)
