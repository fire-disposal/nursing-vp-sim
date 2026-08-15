"""静态模板辅助 —— rubric 文本构建 + 预览示例变量"""

import json


def _get_default_rubric() -> dict:
    from modules.training.scoring.rubric_loader import load_rubric

    return load_rubric("nursing_history_v1")


def build_scoring_criteria(rubric: dict | None = None, level: str = "full") -> str:
    """构建评分标准文本。

    level="full"  → 维度概要 + 条目列表（id + 名称，不含锚点）
    level="brief" → 维度概要 + 条目列表（紧凑格式）
    """
    if rubric is None:
        rubric = _get_default_rubric()

    dimensions = rubric.get("dimensions", [])
    raw_max = rubric.get("raw_max", rubric.get("total_max", 57))
    raw_scale = rubric.get("raw_scale", 3)

    lines = []
    lines.append(f"评分标准: {rubric.get('name', '')} (原始{raw_max}分, 每项1-{raw_scale}分)")
    lines.append("")

    for dim in dimensions:
        dim_name = dim["name"]
        items = dim["items"]
        lines.append(f"## {dim_name}（{len(items)}项，满分{dim['max']}分）")
        if level == "brief":
            lines.append("、".join(it["name"] for it in items))
        else:
            for i, it in enumerate(items):
                lines.append(f"{i + 1}. [{it['id']}] {it['name']}")
        lines.append("")

    return "\n".join(lines)


def build_scoring_json_schema(rubric: dict | None = None, stage: str = "scoring") -> str:
    """构建 LLM 输出的 JSON 格式模板，按阶段返回不同字段。

    stage="scoring" → total_score + detail_scores（逐项评分）
    stage="feedback" → strengths/weaknesses/missed_content/suggestions（反馈）
    """
    if rubric is None:
        rubric = _get_default_rubric()

    dimensions = rubric.get("dimensions", [])
    raw_max = rubric.get("raw_max", rubric.get("total_max", 57))
    rubric_version = rubric.get("version", "")

    if stage == "feedback":
        json_obj = {
            "rubric_version": f"{rubric.get('id', '')}@{rubric_version}",
            "strengths": ["表现较好的具体行为描述1", "..."],
            "weaknesses": ["存在不足的具体行为描述1", "..."],
            "missed_content": ["学生漏问的关键内容1", "..."],
            "suggestions": (
                "个性化改进建议。结合对话中学生的实际表现："
                "具体指出哪些条目做得好，哪些需要改进，给出可操作的改进方向。200-350字"
            ),
        }
        json_template = json.dumps(json_obj, ensure_ascii=False, indent=2)

        lines = []
        lines.append("## 输出格式（必读）")
        lines.append("")
        lines.append("必须是严格的 JSON（不含 markdown 代码块标记）：")
        lines.append("")
        lines.append("**以下字段为必填，不能为空值：**")
        lines.append("- `strengths`：必须至少包含2条具体行为描述，不能是空数组 []")
        lines.append("- `weaknesses`：必须至少包含2条具体行为描述，不能是空数组 []")
        lines.append("- `missed_content`：必须至少包含2条学生漏问的内容，不能是空数组 []")
        lines.append('- `suggestions`：200-350字的个性化改进建议，不能是空字符串 ""')
        lines.append("")
        lines.append("JSON 结构：")
        lines.append("")
        lines.append(json_template)
        return "\n".join(lines)

    item_objs = []
    for dim in dimensions:
        dim_name = dim["name"]
        dim_max = dim["max"]
        items = []
        for item in dim["items"]:
            items.append(
                {"id": item["id"], "name": item["name"], "score": "0~2", "evidence": "≥10字", "reason": "≥5字"}
            )
        item_objs.append({dim_name: {"score": f"N(0~{dim_max})", "items": items}})

    json_obj = {
        "total_score": f"N(0~{raw_max})",
        "detail_scores": {k: v for obj in item_objs for k, v in obj.items()},
    }

    json_template = json.dumps(json_obj, ensure_ascii=False, indent=2)

    lines = []
    lines.append("## 输出格式")
    lines.append("")
    lines.append("严格 JSON，无 markdown 代码块。每项必须有 id/name/score/evidence/reason。")
    lines.append('未涉及的条目: score=0, evidence="未涉及", reason="未涉及"。')
    lines.append("")
    lines.append(json_template)

    return "\n".join(lines)


def build_scoring_rubric(rubric: dict | None = None, required_inquiries: list | None = None) -> str:
    """[兼容] 构建完整评分 rubric（评分标准 + 必须采集清单 + JSON 模板）。
    新代码请使用 build_scoring_criteria() + build_scoring_json_schema() + required_inquiries 分拆方案。"""
    if rubric is None:
        rubric = _get_default_rubric()
    if required_inquiries is None:
        required_inquiries = []

    lines = [build_scoring_criteria(rubric)]
    lines.append("")
    lines.append("## 必须采集到的内容清单（参考）")
    lines.append(json.dumps(required_inquiries, ensure_ascii=False, indent=2))
    lines.append("")
    lines.append(build_scoring_json_schema(rubric))

    return "\n".join(lines)
