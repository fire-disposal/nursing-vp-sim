"""评分校验工具 —— 类型转换 + 字段验证 + 百分制换算"""

import logging

log = logging.getLogger(__name__)


def _check_feedback_empty(result: dict) -> list[str]:
    missing = []
    for field in ("strengths", "weaknesses", "missed_content"):
        if not isinstance(result.get(field), list) or len(result.get(field, [])) == 0:
            missing.append(field)
    if not isinstance(result.get("suggestions"), str) or not result.get("suggestions", "").strip():
        missing.append("suggestions")
    return missing


def _merge_feedback(first: dict, second: dict, missing: list[str]) -> dict:
    merged = dict(first)
    for field in missing:
        val = second.get(field)
        if field in ("strengths", "weaknesses", "missed_content"):
            if isinstance(val, list) and len(val) > 0:
                merged[field] = val
        elif field == "suggestions" and isinstance(val, str) and val.strip():
            merged[field] = val
    return merged


def _inject_rubric_max(result: dict, rubric: dict) -> None:
    """Inject `max` from rubric into each dimension & item.

    The LLM only outputs `score` — `max` is a structural constant
    defined in the rubric, not something the LLM should determine.
    """
    raw_scale = rubric.get("raw_scale", 3)
    dimensions = {d["id"]: d for d in rubric.get("dimensions", [])}
    detail = result.get("detail_scores", {})
    for dim_name, dim_data in detail.items():
        if not isinstance(dim_data, dict):
            continue
        # Find matching rubric dimension by name fallback
        rd = next((d for d in dimensions.values() if d["name"] == dim_name), None)
        if rd:
            dim_data["max"] = rd["max"]
        else:
            dim_data.setdefault("max", sum(
                raw_scale for _ in dim_data.get("items", [])
            ) or raw_scale)

        for item in dim_data.get("items", []):
            if isinstance(item, dict):
                item["max"] = raw_scale


def _coerce_numeric_fields(obj: dict, depth: int = 0):
    if depth > 10:
        log.warning("coerce_numeric_fields 超过最大递归深度 %d", depth)
        return
    for key in ("total_score", "score", "max"):
        if key in obj and isinstance(obj[key], str):
            raw = obj[key]
            try:
                obj[key] = float(raw) if "." in raw else int(raw)
            except ValueError:
                log.warning("coerce_numeric_fields 无法转换: key=%s value=%r", key, raw[:200])
    for value in obj.values():
        if isinstance(value, dict):
            _coerce_numeric_fields(value, depth + 1)
        elif isinstance(value, list):
            for item in value:
                if isinstance(item, dict):
                    _coerce_numeric_fields(item, depth + 1)


def _validate_scoring_essentials(result: dict):
    """第一阶段校验：仅检查 total_score 和 detail_scores 核心字段。"""
    if "total_score" not in result:
        raise ValueError("缺失字段: total_score")
    if not isinstance(result["total_score"], (int, float)):
        raise TypeError(f"total_score 类型错误: {type(result['total_score']).__name__}")
    if "detail_scores" not in result:
        raise ValueError("缺失字段: detail_scores")
    if not isinstance(result["detail_scores"], dict):
        raise TypeError(f"detail_scores 类型错误: {type(result['detail_scores']).__name__}")


def _validate_feedback_fields(result: dict):
    """第二阶段校验：仅检查四个反馈字段。"""
    empty = _check_feedback_empty(result)
    if empty:
        raise ValueError(f"反馈字段不完整: {', '.join([f'{f}(为空)' for f in empty])}")


def _validate_items_content(detail_scores: dict) -> list[str]:
    errors = []
    for dim_name, dim_data in detail_scores.items():
        if not isinstance(dim_data, dict):
            continue
        for item in dim_data.get("items", []):
            if not isinstance(item, dict):
                continue
            item_score = item.get("score", 0)
            if isinstance(item_score, str):
                raw_score = item_score
                try:
                    item_score = float(item_score)
                except ValueError:
                    log.warning(
                        "评分条目 score 字符串无法转换: dim=%s item=%s value=%r",
                        dim_name,
                        item.get("name", "?"),
                        raw_score[:100],
                    )
                    item_score = 0
            if not isinstance(item_score, (int, float)):
                log.warning(
                    "评分条目 score 类型异常(强制清零): dim=%s item=%s type=%s",
                    dim_name,
                    item.get("name", "?"),
                    type(item_score).__name__,
                )
                item_score = 0
            ev = (item.get("evidence") or "").strip()
            rea = (item.get("reason") or "").strip()
            # Only require detailed evidence/reason if the student scored points
            if item_score > 0:
                if len(ev) < 10:
                    errors.append(f"{dim_name}.{item.get('name', '?')}: evidence 过短 ({len(ev)}字)")
                if len(rea) < 5:
                    errors.append(f"{dim_name}.{item.get('name', '?')}: reason 过短 ({len(rea)}字)")
    return errors


def _validate_scoring_result(result: dict, rubric: dict | None = None):
    """最终校验：全字段完整性检查。"""
    type_defaults = {
        "strengths": [],
        "weaknesses": [],
        "missed_content": [],
        "suggestions": "",
    }
    for field, default in type_defaults.items():
        if field in result and not isinstance(result[field], type(default)):
            result[field] = default

    _validate_scoring_essentials(result)

    item_errors = _validate_items_content(result.get("detail_scores", {}))
    if item_errors:
        log.warning(
            "评分条目内容校验不通过（降为警告，不阻断评分）",
            extra={"item_errors": item_errors, "detail_scores": result.get("detail_scores", {})},
        )

    empty_feedback = []
    for field, expected_type in [
        ("strengths", list),
        ("weaknesses", list),
        ("missed_content", list),
        ("suggestions", str),
    ]:
        value = result.get(field)
        if value is None:
            empty_feedback.append(f"{field}(缺失)")
        elif not isinstance(value, expected_type):
            empty_feedback.append(f"{field}(类型错误)")
        elif (expected_type is list and len(value) == 0) or (expected_type is str and not value.strip()):
            empty_feedback.append(f"{field}(为空)")
    if empty_feedback:
        raise ValueError(f"LLM评分反馈字段不完整: {', '.join(empty_feedback)}")

    if rubric:
        total_items = 0
        items_with_evidence = 0
        detail_scores = result.get("detail_scores", {})
        for dim in rubric.get("dimensions", []):
            dim_data = detail_scores.get(dim["name"], {})
            for item in dim_data.get("items", []):
                total_items += 1
                if item.get("evidence"):
                    items_with_evidence += 1
        if total_items > 0 and items_with_evidence / total_items < 0.5:
            log.info(
                "scoring_evidence_warning",
                extra={"items_with_evidence": items_with_evidence, "total_items": total_items},
            )


def _convert_to_100_scale(result: dict, raw_max: int):
    if raw_max == 100 or raw_max <= 0:
        return
    factor = 100.0 / raw_max
    result["total_score"] = round(result["total_score"] * factor)

    detail_scores = result.get("detail_scores", {})
    for dim_data in detail_scores.values():
        if isinstance(dim_data, dict):
            dim_data["score"] = round(dim_data.get("score", 0) * factor)
            dim_data["max"] = round(dim_data.get("max", 0) * factor)
            for item in dim_data.get("items", []):
                if isinstance(item, dict):
                    item["score"] = round(item.get("score", 0) * factor)
                    item["max"] = round(item.get("max", 0) * factor)
