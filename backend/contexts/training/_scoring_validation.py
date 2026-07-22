"""评分校验工具 —— 类型转换 + 字段验证 + 百分制换算"""

import logging

from core.score_mapping import SCORE_MAPPING, apply_score_mapping

log = logging.getLogger(__name__)

# ── 校验阈值 ──
MIN_EVIDENCE_CHARS = 10
MIN_REASON_CHARS = 5
EVIDENCE_COVERAGE_THRESHOLD = 0.5  # 至少 50% 的得分项需要提供证据
COERCE_MAX_DEPTH = 10


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
            dim_data.setdefault("max", sum(raw_scale for _ in dim_data.get("items", [])) or raw_scale)

        for item in dim_data.get("items", []):
            if isinstance(item, dict):
                item["max"] = raw_scale


def _coerce_numeric_fields(obj: dict, depth: int = 0):
    if depth > COERCE_MAX_DEPTH:
        log.warning("coerce_numeric_fields 超过最大递归深度 %d", COERCE_MAX_DEPTH)
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
                if len(ev) < MIN_EVIDENCE_CHARS:
                    errors.append(f"{dim_name}.{item.get('name', '?')}: evidence 过短 ({len(ev)}字)")
                if len(rea) < MIN_REASON_CHARS:
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
        if total_items > 0 and items_with_evidence / total_items < EVIDENCE_COVERAGE_THRESHOLD:
            log.info(
                "scoring_evidence_warning",
                extra={"items_with_evidence": items_with_evidence, "total_items": total_items},
            )


def _convert_to_100_scale(result: dict, raw_max: int):
    """使用可配置的分数映射将原始分转换为显示分。
    
    配置位于 core/score_mapping.py 的 SCORE_MAPPING 单例，
    修改其属性即可调整映射行为，无需重跑评分。
    """
    if raw_max <= 0:
        return

    cfg = SCORE_MAPPING
    result["total_score"] = apply_score_mapping(result["total_score"], raw_max, cfg)

    factor = cfg.display_max / raw_max if cfg.curve == "linear" else 1.0

    detail_scores = result.get("detail_scores", {})
    for dim_data in detail_scores.values():
        if isinstance(dim_data, dict):
            dim_data["score"] = round(dim_data.get("score", 0) * factor)
            dim_data["max"] = round(dim_data.get("max", 0) * factor)
            for item in dim_data.get("items", []):
                if isinstance(item, dict):
                    item["score"] = round(item.get("score", 0) * factor)
                    item["max"] = round(item.get("max", 0) * factor)


def _filter_hallucinated_dimensions(detail_scores: dict, rubric_dim_names: set[str]) -> dict:
    removed = [k for k in detail_scores if k not in rubric_dim_names]
    if removed:
        log.warning("hallucinated_dimensions_removed", extra={"dimensions": removed})
    return {k: v for k, v in detail_scores.items() if k in rubric_dim_names}


def _clamp_scores(detail_scores: dict, raw_scale: int) -> None:
    if raw_scale <= 0:
        return
    for dim_data in detail_scores.values():
        if not isinstance(dim_data, dict):
            continue
        dim_max = dim_data.get("max", 0)
        if "score" in dim_data:
            dim_data["score"] = max(0.0, min(float(dim_data["score"]), float(dim_max)))
        for item in dim_data.get("items", []):
            if isinstance(item, dict):
                item["score"] = max(0.0, min(float(item.get("score", 0)), float(raw_scale)))


def _recalc_total_from_dimensions(detail_scores: dict, raw_scale: int) -> float:
    if raw_scale <= 0:
        return 0.0
    total = 0.0
    for dim_data in detail_scores.values():
        if not isinstance(dim_data, dict):
            continue
        dim_score = dim_data.get("score", 0)
        dim_max = dim_data.get("max", 0)
        items = dim_data.get("items", [])
        if isinstance(items, list) and len(items) > 0 and dim_max > 0:
            raw_max_dim = len(items) * raw_scale
            total += round(dim_score * dim_max / raw_max_dim, 1)
        else:
            total += dim_score
    return round(total, 1)


def _inject_missing_dimensions(detail_scores: dict, rubric: dict) -> None:
    raw_scale = rubric.get("raw_scale", 3)
    for dim in rubric.get("dimensions", []):
        dim_name = dim["name"]
        if dim_name not in detail_scores:
            items = [{"id": it["id"], "name": it["name"], "score": 0, "max": raw_scale} for it in dim.get("items", [])]
            detail_scores[dim_name] = {
                "score": 0,
                "max": dim.get("max", 0),
                "items": items,
                "_injected": True,
            }
            log.warning("missing_dimension_injected", extra={"dimension": dim_name})
