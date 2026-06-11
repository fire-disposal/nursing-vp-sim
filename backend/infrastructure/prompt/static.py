"""静态模板辅助 —— rubric 文本构建 + 预览示例变量"""

import json


def _get_default_rubric() -> dict:
    from repositories.rubric import load_rubric

    return load_rubric("nursing_history_v1")


def build_scoring_criteria(rubric: dict | None = None) -> str:
    """构建评分标准文本（维度、条目、锚点），不含必须采集清单和 JSON 模板"""
    if rubric is None:
        rubric = _get_default_rubric()

    dimensions = rubric.get("dimensions", [])
    raw_max = rubric.get("raw_max", rubric.get("total_max", 57))
    rubric_name = rubric.get("name", "")
    rubric_version = rubric.get("version", "")
    raw_scale = rubric.get("raw_scale", 3)
    display_max = rubric.get("total_max", 100)

    lines = []
    lines.append("## 评分标准版本")
    lines.append(
        f"{rubric_name} v{rubric_version}（原始{raw_max}分制，每项1-{raw_scale}分，系统将自动换算为{display_max}分制）"
    )
    lines.append("")
    lines.append("## 评估维度与条目")
    lines.append("")

    for dim in dimensions:
        dim_name = dim["name"]
        dim_max = dim["max"]
        lines.append(f"### {dim_name}（{len(dim['items'])}项，满分{dim_max}分）")
        if dim.get("description"):
            lines.append(str(dim["description"]))
        lines.append("")

        for i, item in enumerate(dim["items"]):
            anchors = item.get("anchors", {})
            anchor_text = " / ".join(f"{k}分: {v}" for k, v in sorted(anchors.items()))
            lines.append(f"{i + 1}. {item['name']} — {anchor_text}")

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
            "suggestions": "个性化改进建议。需结合对话中学生的实际表现：具体指出哪些条目做得好，哪些条目需要改进，给出可操作的改进方向。200-350字",
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
                {
                    "id": item["id"],
                    "name": item["name"],
                    "score": "N_ITEM_SCORE",
                    "evidence": "对话中的具体证据（30-80字）",
                    "reason": "评分理由（20-50字）",
                }
            )
        item_objs.append({dim_name: {"score": "N_DIM_SCORE", "max": dim_max, "items": items}})

    json_obj = {
        "rubric_version": f"{rubric.get('id', '')}@{rubric_version}",
        "total_score": "N_TOTAL_SCORE",
        "detail_scores": {k: v for obj in item_objs for k, v in obj.items()},
    }

    json_template = json.dumps(json_obj, ensure_ascii=False, indent=2)
    json_template = json_template.replace('"N_TOTAL_SCORE"', f"数字(满分{raw_max})")
    json_template = json_template.replace('"N_DIM_SCORE"', f"数字(满分{raw_max})")
    json_template = json_template.replace('"N_ITEM_SCORE"', "1-3")

    lines = []
    lines.append("## 输出格式（必读）")
    lines.append("")
    lines.append("必须是严格的 JSON（不含 markdown 代码块标记），所有数字字段不要加引号：")
    lines.append("")
    lines.append("JSON 结构：")
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
