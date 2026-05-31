"""静态模板辅助 —— rubric 文本构建 + 预览示例变量"""
import json
import re
from rubrics import load_rubric


def build_scoring_rubric(rubric: dict | None = None,
                         required_inquiries: list | None = None) -> str:
    """构建评分 rubric 完整内容（评分标准 + 必须采集清单 + JSON 输出模板）。
    一次返回完整字符串，模板中只需一个 {#scoring_rubric#} 变量。"""
    if rubric is None:
        rubric = load_rubric("nursing_history_v1")
    if required_inquiries is None:
        required_inquiries = []

    dimensions = rubric.get("dimensions", [])
    raw_max = rubric.get("raw_max", rubric.get("total_max", 57))
    rubric_name = rubric.get("name", "")
    rubric_version = rubric.get("version", "")
    raw_scale = rubric.get("raw_scale", 3)
    display_max = rubric.get("total_max", 100)

    lines = []
    lines.append(f"## 评分标准版本")
    lines.append(f"{rubric_name} v{rubric_version}（原始{raw_max}分制，每项1-{raw_scale}分，系统将自动换算为{display_max}分制）")
    lines.append("")
    lines.append("## 评估维度与条目")
    lines.append("")

    item_objs = []
    for dim in dimensions:
        dim_name = dim["name"]
        dim_max = dim["max"]
        lines.append(f"### {dim_name}（{len(dim['items'])}项，满分{dim_max}分）")
        if dim.get("description"):
            lines.append(str(dim["description"]))
        lines.append("")

        items = []
        for item in dim["items"]:
            anchors = item.get("anchors", {})
            anchor_text = " / ".join(f"{k}分: {v}" for k, v in sorted(anchors.items()))
            lines.append(f"{dim['items'].index(item) + 1}. {item['name']} — {anchor_text}")
            items.append({
                "id": item["id"],
                "name": item["name"],
                "score": "N_ITEM_SCORE",
                "evidence": "对话中的具体证据（30-80字）",
                "reason": "评分理由（20-50字）",
            })
        item_objs.append({dim_name: {"score": "N_DIM_SCORE", "max": dim_max, "items": items}})

    lines.append("")
    lines.append("## 必须采集到的内容清单（参考）")
    lines.append(json.dumps(required_inquiries, ensure_ascii=False, indent=2))
    lines.append("")

    json_obj = {
        "rubric_version": f"{rubric.get('id', '')}@{rubric_version}",
        "total_score": "N_TOTAL_SCORE",
        "detail_scores": {k: v for obj in item_objs for k, v in obj.items()},
        "strengths": ["表现较好的具体行为描述1", "..."],
        "weaknesses": ["存在不足的具体行为描述1", "..."],
        "missed_content": ["学生漏问的关键内容1", "..."],
        "suggestions": "个性化改进建议。需结合对话中学生的实际表现：具体指出哪些条目做得好，哪些条目需要改进，给出可操作的改进方向。200-350字",
    }

    json_template = json.dumps(json_obj, ensure_ascii=False, indent=2)
    json_template = json_template.replace('"N_TOTAL_SCORE"', f'数字(满分{raw_max})')
    json_template = json_template.replace('"N_DIM_SCORE"', f'数字(满分{raw_max})')
    json_template = json_template.replace('"N_ITEM_SCORE"', '1-3')

    lines.append("## 输出格式")
    lines.append("")
    lines.append("必须是严格的 JSON（不含 markdown 代码块标记），所有数字字段不要加引号：")
    lines.append("")
    lines.append(json_template)

    return "\n".join(lines)


# ── 预览示例变量（首次访问时延迟计算）──

_sample_required = ["主诉（部位、性质、持续时间、诱因）",
                    "现病史（起病情况、发展经过、诊疗经过）",
                    "既往史", "过敏史", "用药史"]

_SAMPLE_VARS_CACHE: dict | None = None


def get_sample_vars() -> dict:
    global _SAMPLE_VARS_CACHE
    if _SAMPLE_VARS_CACHE is None:
        rubric = load_rubric("nursing_history_v1")
        _SAMPLE_VARS_CACHE = {
            "scoring": {
                "scoring_rubric": build_scoring_rubric(rubric, _sample_required),
                "conversation_text": "护士：您好，我是今天的护理实习生，请问您哪里不舒服？\n\n患者：我最近总是头疼，大概三天了。\n\n护士：能具体说说疼的位置和感觉吗？\n\n患者：主要是前额这里，一跳一跳的疼。\n\n护士：以前有过类似情况吗？\n\n患者：以前偶尔也会，但是没这么频繁。",
            },
            "patient_chat": {
                "communication_style": "友善自然，略带焦虑",
                "patient_info": "张三，45岁，男",
                "chief_complaint": "头痛3天，加重1天",
                "present_illness": "3天前无明显诱因出现前额部搏动性疼痛，程度中等，伴有恶心，无呕吐，熬夜后加重",
                "allergy_history": "青霉素过敏",
                "hidden_info_rules": "- 患者担心自己可能患有脑部疾病，但不愿主动提及\n- 近期因工作压力大，睡眠质量差",
            },
            "qa": {},
            "case_generation": {
                "description": "糖尿病足溃疡老年患者，有10年糖尿病史，近期足部出现溃疡不愈合",
                "reference_material": "患者长期血糖控制不佳，HbA1c 9.2%。参考标准糖尿病足护理评估流程。",
            },
        }
        return _SAMPLE_VARS_CACHE
