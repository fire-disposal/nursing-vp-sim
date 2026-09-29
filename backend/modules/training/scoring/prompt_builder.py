"""静态模板辅助 —— rubric 文本构建 + 预览示例变量。

锚点必须真的送达模型：``level="full"`` 的评分标准文本逐条列出
每个条目的 0/1/2 行为锚点，标题与真实量尺一致（``0–raw_scale``，不是 ``1–raw_scale``）。
只发条目名称却声称行为评分已生效，是本批次要消除的缺口。
"""

import json


def _get_default_rubric() -> dict:
    from modules.training.scoring.rubric_loader import load_rubric

    return load_rubric()


def _anchor_lines(item: dict) -> list[str]:
    """条目锚点文本；按分值降序，缺哪个分值就少哪一行（不编造锚点）。"""
    anchors = item.get("anchors")
    if not isinstance(anchors, dict):
        return []
    lines: list[str] = []
    for key in sorted(anchors, key=lambda k: (-float(k) if str(k).replace(".", "", 1).isdigit() else 0, str(k))):
        text = str(anchors.get(key) or "").strip()
        if text:
            lines.append(f"   - {key} 分：{text}")
    return lines


def build_scoring_criteria(rubric: dict | None = None, level: str = "full") -> str:
    """构建评分标准文本。

    level="full"  → 维度概要 + 每条的 id/名称/行为锚点（评分阶段使用）
    level="brief" → 维度概要 + 条目 id+名称（反馈阶段使用，不参与判分）
    """
    if rubric is None:
        rubric = _get_default_rubric()

    dimensions = rubric.get("dimensions", [])
    raw_max = rubric.get("raw_max", rubric.get("total_max", 57))
    raw_scale = rubric.get("raw_scale", 3)

    lines = []
    lines.append(f"评分标准: {rubric.get('name', '')}（原始 {raw_max} 分；每项 0-{raw_scale} 分，每项满分{raw_scale}）")
    if level != "brief":
        lines.append("逐项判分必须依据该条目的行为锚点；适用条目与分母以「本次任务边界」为准。")
    lines.append("")

    for dim in dimensions:
        dim_name = dim["name"]
        items = dim["items"]
        lines.append(f"## {dim_name}（{len(items)}项，满分{dim['max']}分）")
        if level == "brief":
            lines.append("、".join(f"[{it['id']}]{it['name']}" for it in items))
        else:
            for i, it in enumerate(items):
                lines.append(f"{i + 1}. [{it['id']}] {it['name']}")
                lines.extend(_anchor_lines(it))
        lines.append("")

    return "\n".join(lines)


def build_scoring_json_schema(rubric: dict | None = None, stage: str = "scoring") -> str:
    """构建 LLM 输出的 JSON 格式模板，按阶段返回不同字段。

    stage="scoring" → total_score + detail_scores（逐项评分，含证据与状态）
    stage="feedback" → strengths/weaknesses/missed_content/suggestions（反馈，可为空）
    """
    if rubric is None:
        rubric = _get_default_rubric()

    dimensions = rubric.get("dimensions", [])
    raw_max = rubric.get("raw_max", rubric.get("total_max", 57))
    raw_scale = rubric.get("raw_scale", 2)
    rubric_version = rubric.get("version", "")

    if stage == "feedback":
        json_obj = {
            "rubric_version": f"{rubric.get('id', '')}@{rubric_version}",
            "strengths": ["表现较好的具体行为描述（有证据才写）"],
            "weaknesses": ["确实存在的不足；没有明确不足时留空数组"],
            "missed_content": ["对照必须覆盖项确实漏掉的内容；没有时留空数组"],
            "suggestions": "个性化改进建议（无确定结论时说明证据不足，不编造）。",
        }
        json_template = json.dumps(json_obj, ensure_ascii=False, indent=2)

        lines = []
        lines.append("## 输出格式（必读）")
        lines.append("")
        lines.append("必须是严格的 JSON（不含 markdown 代码块标记）：")
        lines.append("")
        lines.append("**字段语义（空值是合法结果，不是失败）：**")
        lines.append("- `strengths`：有具体行为证据的亮点；没有则空数组")
        lines.append("- `weaknesses`：确实存在的不足；**没有明确不足时必须是空数组**，不得为凑数编造")
        lines.append("- `missed_content`：对照必须覆盖项确实漏掉的内容；没有漏问时必须是空数组")
        lines.append("- `suggestions`：个性化改进建议；证据不足时直接说明，不编造结论")
        lines.append("")
        lines.append("每条内容都必须引用对话中的具体行为，不得凭印象泛化。")
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
                    "score": f"0~{raw_scale} 的整数，或 null（仅限本次任务边界声明为不适用的条目）",
                    "evidence": "对话原文引用（引用学生或患者的原话片段）；score>0 时必须给出",
                    "reason": "为什么给这个分数：引用支持证据，或说明未达成的要求与相关上下文",
                }
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
    lines.append("未涉及的条目：score=0，reason 说明缺失的要求；不必编造 evidence。")
    lines.append("任务边界声明为不适用的条目：score=null，reason 说明该条目不适用。")
    lines.append("")
    lines.append(json_template)

    return "\n".join(lines)
