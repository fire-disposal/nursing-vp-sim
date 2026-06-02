import json
from services.llm_service import _safe_parse_json

sample = json.dumps({
    "rubric_version": "nursing_history_v1@1.0",
    "total_score": 42,
    "detail_scores": {
        "沟通技能": {
            "score": 30, "max": 42,
            "items": [
                {"id": "comm_01", "name": "打招呼", "score": 2, "evidence": "学生问候了", "reason": "态度友好"}
            ]
        },
        "病史采集": {
            "score": 12, "max": 15,
            "items": [
                {"id": "hist_01", "name": "询问病史", "score": 3, "evidence": "详细询问", "reason": "覆盖全面"}
            ]
        }
    },
    "strengths": ["沟通自然"],
    "weaknesses": ["漏问过敏史"],
    "missed_content": ["过敏史"],
    "suggestions": "继续保持"
}, ensure_ascii=False)

result = _safe_parse_json(sample)
print(f"total_score: {result.get('total_score')}")
ds = result.get("detail_scores", {})
for k, v in ds.items():
    items = v.get("items", [])
    print(f"  {k}: score={v.get('score')}, max={v.get('max')}, items={len(items)}")
    for item in items:
        print(f"    {item.get('id')}: score={item.get('score')}, evidence={item.get('evidence', '')[:30]}")
print(f"strengths: {result.get('strengths')}")
print("OK - all parsing correct")
