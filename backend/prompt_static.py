"""静态模板辅助 —— rubric 文本构建 + 预览示例变量 + 安全格式化"""
import json
from rubrics import load_rubric


def _esc(text: str) -> str:
    """将 { } 转义为 {{ }}，防止被 str.format() 误解析"""
    return text.replace("{", "{{").replace("}", "}}")


def build_rubric_blocks(rubric: dict | None = None) -> tuple[str, str]:
    """基于 rubric JSON 构建 rubric_dim_text（含版本信息）和 rubric_json_template。
    所有输出均已完全转义，可直接用于 str.format() 模板。"""
    if rubric is None:
        rubric = load_rubric("nursing_history_v1")
    dimensions = rubric.get("dimensions", [])
    raw_max = rubric.get("raw_max", rubric.get("total_max", 57))
    rubric_name = rubric.get("name", "")
    rubric_version = rubric.get("version", "")
    raw_scale = rubric.get("raw_scale", 3)
    display_max = rubric.get("total_max", 100)

    dim_lines = []
    item_objs = []
    for dim in dimensions:
        dim_name = dim["name"]
        dim_max = dim["max"]
        dim_lines.append(f"### {dim_name}（{len(dim['items'])}项，满分{dim_max}分）")
        if dim.get("description"):
            dim_lines.append(str(dim["description"]))
        dim_lines.append("")

        items = []
        for item in dim["items"]:
            anchors = item.get("anchors", {})
            anchor_text = " / ".join(f"{k}分: {v}" for k, v in sorted(anchors.items()))
            dim_lines.append(f"{dim['items'].index(item) + 1}. {item['name']} — {anchor_text}")
            items.append({
                "id": item["id"],
                "name": item["name"],
                "score": "1-3",
                "evidence": "对话中的具体证据（30-80字）",
                "reason": "评分理由（20-50字）",
            })
        item_objs.append({dim_name: {"score": f"数字(满分{dim_max})", "max": dim_max, "items": items}})

    version_info = (
        f"## 评分标准版本\n"
        f"{rubric_name} v{rubric_version}（原始{raw_max}分制，每项1-{raw_scale}分，系统将自动换算为{display_max}分制）\n"
        f"\n## 评估维度与条目\n\n"
        f"{chr(10).join(dim_lines)}"
    )

    json_obj = {
        "rubric_version": f"{rubric.get('id', '')}@{rubric_version}",
        "total_score": f"数字(满分{raw_max})",
        "detail_scores": {k: v for obj in item_objs for k, v in obj.items()},
        "strengths": ["表现较好的具体行为描述1", "..."],
        "weaknesses": ["存在不足的具体行为描述1", "..."],
        "missed_content": ["学生漏问的关键内容1", "..."],
        "suggestions": "个性化改进建议。需结合对话中学生的实际表现：具体指出哪些条目做得好，哪些条目需要改进，给出可操作的改进方向。200-350字",
    }
    rubric_json_template = _esc(json.dumps(json_obj, ensure_ascii=False, indent=2))

    return version_info, rubric_json_template


# ── 预览示例变量（模块加载时预计算）──

_rubric_dim_text, _rubric_json_template = build_rubric_blocks()

SAMPLE_VARS = {
    "scoring": {
        "rubric_dim_text": _rubric_dim_text,
        "rubric_json_template": _rubric_json_template,
        "required_inquiries": '[\n  "主诉（部位、性质、持续时间、诱因）",\n  "现病史（起病情况、发展经过、诊疗经过）",\n  "既往史",\n  "过敏史",\n  "用药史"\n]',
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
}
