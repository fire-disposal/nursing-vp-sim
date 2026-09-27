"""评分校验工具 —— 类型转换 + 字段验证 + 原始量尺与展示投影。

本批次（docs/19 §4.2）的三个不变量在这里落地：

* **原始精度**：条目分与条目上限按 rubric 原始刻度（0-``raw_scale``）保存与判定，
  展示换算（×factor、取整）只发生在最后一步，且只作用于展示投影层；
* **适用性**：只有病例声明的条目可以是 ``not_applicable``（score=None），其余条目必须
  有分数 —— 模型无法用"没答上来"缩小分母；
* **反馈可为空**：字段缺失或类型错误才触发重试；空数组/空串是合法结果，不再强迫补全。
"""

import logging

from .mapping import apply_score_mapping, display_factor

log = logging.getLogger(__name__)

# ── 校验阈值 ──
EVIDENCE_COVERAGE_THRESHOLD = 0.5  # 报告用：至少 50% 的条目带证据（不阻断评分）
COERCE_MAX_DEPTH = 10

STATUS_SCORED = "scored"
STATUS_NOT_APPLICABLE = "not_applicable"
STATUS_UNSCORED_BY_MODEL = "unscored_by_model"

FEEDBACK_LIST_FIELDS = ("strengths", "weaknesses", "missed_content")


# ── 反馈字段：只判「缺失/类型错误」，空值是合法结果 ──


def _missing_feedback_fields(result: dict) -> list[str]:
    """返回缺失或类型非法的反馈字段标签；**空数组/空串不算缺失**。

    这是「取消凑反馈」的判定处（docs/19 §4.2 第 5 条）：没有明确不足是真实结果，
    不得因为它触发补全重试把「无不足」变成编造的不足。
    """
    missing: list[str] = []
    for field in FEEDBACK_LIST_FIELDS:
        if field not in result:
            missing.append(f"{field}(缺失)")
        elif not isinstance(result[field], list):
            missing.append(f"{field}(类型错误)")
    if "suggestions" not in result:
        missing.append("suggestions(缺失)")
    elif not isinstance(result["suggestions"], str):
        missing.append("suggestions(类型错误)")
    return missing


def _merge_feedback(first: dict, second: dict, missing: list[str]) -> dict:
    """用第二轮结果补齐第一轮缺失/非法字段（空数组同样接受）。"""
    merged = dict(first)
    for field in missing:
        name = field.split("(")[0]
        val = second.get(name)
        if name in FEEDBACK_LIST_FIELDS:
            if isinstance(val, list):
                merged[name] = val
        elif name == "suggestions" and isinstance(val, str):
            merged[name] = val
    return merged


def _normalize_feedback_fields(result: dict) -> list[str]:
    """反馈字段类型归一化（唯一判定处）。返回缺失/非法字段标签，供日志使用；不抛异常。"""
    defaults: dict[str, object] = {**{f: [] for f in FEEDBACK_LIST_FIELDS}, "suggestions": ""}
    for field, default in defaults.items():
        if field in result and not isinstance(result[field], type(default)):
            result[field] = default

    problems: list[str] = []
    for field, expected in (*((f, list) for f in FEEDBACK_LIST_FIELDS), ("suggestions", str)):
        value = result.get(field)
        if value is None:
            problems.append(f"{field}(缺失)")
            result[field] = [] if expected is list else ""
        elif not isinstance(value, expected):
            problems.append(f"{field}(类型错误)")
            result[field] = [] if expected is list else ""
    return problems


# ── 数值与结构 ──


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


def _inject_rubric_max(result: dict, rubric: dict) -> None:
    """把 rubric 的结构常量注入条目：条目上限恒为 ``raw_scale``（原始刻度）。"""
    raw_scale = rubric.get("raw_scale", 3)
    detail = result.get("detail_scores", {})
    for dim_name, dim_data in detail.items():
        if not isinstance(dim_data, dict):
            continue
        rd = next((d for d in rubric.get("dimensions", []) if d["name"] == dim_name), None)
        if rd:
            dim_data["max"] = rd["max"]
        else:
            dim_data.setdefault("max", sum(raw_scale for _ in dim_data.get("items", [])) or raw_scale)
        for item in dim_data.get("items", []):
            if isinstance(item, dict):
                item["max"] = raw_scale


def _clamp_scores(detail_scores: dict, raw_scale: int) -> None:
    if raw_scale <= 0:
        return
    for dim_data in detail_scores.values():
        if not isinstance(dim_data, dict):
            continue
        dim_max = dim_data.get("max", 0)
        if isinstance(dim_data.get("score"), (int, float)):
            dim_data["score"] = max(0.0, min(float(dim_data["score"]), float(dim_max)))
        for item in dim_data.get("items", []):
            if not isinstance(item, dict):
                continue
            if item.get("score") is None:
                continue
            item["score"] = max(0.0, min(float(item.get("score", 0)), float(raw_scale)))


def _recalc_total_from_dimensions(detail_scores: dict, raw_scale: int = 2) -> float:
    """总分 = Σ条目分（原始刻度）。``score=None`` 的条目不参与（不适用或未判）。"""
    if raw_scale <= 0:
        return 0.0
    total = 0.0
    for dim_data in detail_scores.values():
        if not isinstance(dim_data, dict):
            continue
        for item in dim_data.get("items", []) or []:
            if not isinstance(item, dict):
                continue
            s = item.get("score")
            if not isinstance(s, (int, float)):
                continue
            total += max(0.0, min(float(s), float(raw_scale)))
    return round(total, 1)


def _apply_item_status(detail_scores: dict, not_applicable: frozenset[str]) -> tuple[list[str], list[str]]:
    """按病例声明标注每个条目的状态（唯一判定处）。

    返回 ``(declared_not_applicable, unscored_by_model)``：

    * ``declared_not_applicable`` —— 病例声明不适用且确实出现在结果里的条目 id（不含入分母）
    * ``unscored_by_model`` —— 未声明不适用却没有分数的条目：这是模型/系统问题，必须显式
      标记（记录级 fallback），**不得**当成学生得 0 分进入统计
    """
    declared: list[str] = []
    unscored: list[str] = []
    for dim_data in detail_scores.values():
        if not isinstance(dim_data, dict):
            continue
        for item in dim_data.get("items", []) or []:
            if not isinstance(item, dict):
                continue
            item_id = str(item.get("id") or "")
            has_score = isinstance(item.get("score"), (int, float))
            if item_id and item_id in not_applicable:
                item["score"] = None
                item["status"] = STATUS_NOT_APPLICABLE
                declared.append(item_id)
            elif has_score:
                item["status"] = STATUS_SCORED
            else:
                item["status"] = STATUS_UNSCORED_BY_MODEL
                unscored.append(f"{dim_data.get('id') or ''}:{item_id or item.get('name') or '?'}")
    return declared, unscored


def _recalc_dim_max(detail_scores: dict, raw_scale: int) -> None:
    """维度上限 = 该维度**适用**条目数 × ``raw_scale``（不适用条目不计入分母）。"""
    for dim_data in detail_scores.values():
        if not isinstance(dim_data, dict):
            continue
        applicable = sum(
            1
            for item in dim_data.get("items", []) or []
            if isinstance(item, dict) and item.get("status") != STATUS_NOT_APPLICABLE
        )
        dim_data["max"] = raw_scale * applicable


def applicable_raw_max(detail_scores: dict, raw_scale: int) -> float:
    """本次评分适用的原始满分（分母）。不适用条目不计入，模型未判条目仍计入。"""
    total = 0.0
    for dim_data in detail_scores.values():
        if not isinstance(dim_data, dict):
            continue
        for item in dim_data.get("items", []) or []:
            if not isinstance(item, dict):
                continue
            if item.get("status") == STATUS_NOT_APPLICABLE:
                continue
            total += float(raw_scale)
    return total


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
    if not result["detail_scores"]:
        raise ValueError("detail_scores 为空，LLM 未返回任何维度评分")


def _validate_feedback_fields(result: dict):
    """第二阶段校验：只判缺失/类型非法（空反馈合法，不触发重试）。"""
    missing = _missing_feedback_fields(result)
    if missing:
        raise ValueError(f"反馈字段不完整: {', '.join(missing)}")


def _validate_items_content(detail_scores: dict, not_applicable: frozenset[str] = frozenset()) -> list[str]:
    """条目内容校验：得分要有可核对的证据，失分要说明判定依据。

    不再设字数下限 —— 简洁有效的表达不得因为短而被判无效（docs/19 §4.2 第 3 条）。
    """
    errors: list[str] = []
    for dim_name, dim_data in detail_scores.items():
        if not isinstance(dim_data, dict):
            continue
        for item in dim_data.get("items", []):
            if not isinstance(item, dict):
                continue
            label = f"{dim_name}.{item.get('name') or item.get('id') or '?'}"
            item_id = str(item.get("id") or "")
            score = item.get("score")
            if score is None:
                if item_id not in not_applicable:
                    errors.append(f"{label}: 缺少 score（只有病例声明不适用的条目才可为 null）")
                continue
            if not isinstance(score, (int, float)):
                errors.append(f"{label}: score 类型非法({type(score).__name__})")
                continue
            evidence = str(item.get("evidence") or "").strip()
            reason = str(item.get("reason") or "").strip()
            if score > 0 and not evidence:
                errors.append(f"{label}: 得分缺少证据引用")
            if score <= 0 and not reason:
                errors.append(f"{label}: 未得分缺少判定依据(reason)")
    return errors


def _filter_hallucinated_dimensions(detail_scores: dict, rubric_dim_names: set[str]) -> dict:
    removed = [k for k in detail_scores if k not in rubric_dim_names]
    if removed:
        log.warning("hallucinated_dimensions_removed", extra={"dimensions": removed})
    return {k: v for k, v in detail_scores.items() if k in rubric_dim_names}


def rubric_item_index(rubric: dict) -> dict[str, dict[str, str]]:
    """``{维度名: {条目 id: 条目名}}`` —— 本次评分**应当**覆盖的条目集合（冻结 rubric）。"""
    index: dict[str, dict[str, str]] = {}
    for dim in rubric.get("dimensions", []) or []:
        if not isinstance(dim, dict):
            continue
        index[str(dim.get("name") or "")] = {
            str(item.get("id") or ""): str(item.get("name") or "")
            for item in dim.get("items", []) or []
            if isinstance(item, dict) and item.get("id")
        }
    return index


def _filter_hallucinated_items(detail_scores: dict, rubric: dict) -> list[str]:
    """剔除维度内**不在 rubric 里**的条目；返回被剔除的 ``维度/条目`` 标签。

    这些条目会让分母超过该病例声明的原始满分（凭空抬分或抬分母），必须丢弃而不是计分。
    """
    index = rubric_item_index(rubric)
    removed: list[str] = []
    for dim_name, dim_data in detail_scores.items():
        if not isinstance(dim_data, dict):
            continue
        valid = index.get(str(dim_name))
        if valid is None:
            continue
        kept = []
        for item in dim_data.get("items", []) or []:
            if not isinstance(item, dict):
                continue
            item_id = str(item.get("id") or "")
            if item_id in valid:
                kept.append(item)
            else:
                removed.append(f"{dim_name}/{item_id or item.get('name') or '?'}")
        dim_data["items"] = kept
    if removed:
        log.warning("hallucinated_items_removed", extra={"items": removed})
    return removed


def _inject_missing_dimensions(
    detail_scores: dict, rubric: dict, not_applicable: frozenset[str] = frozenset()
) -> list[str]:
    """为缺失维度注入条目；返回被注入的维度名列表（供 fallback 标记，S4）。

    注入的条目状态是 ``unscored_by_model``（score=None），不是 0 分：模型没答上来不等于学生没做，
    0 分会让学生与教师把"系统漏答"读成"学生表现差"，而且会压低分母。调用方据注入结果标记
    fallback（该记录不进统计）。
    """
    raw_scale = rubric.get("raw_scale", 3)
    injected: list[str] = []
    for dim in rubric.get("dimensions", []):
        dim_name = dim["name"]
        if dim_name in detail_scores:
            continue
        items = []
        for it in dim.get("items", []):
            na = it["id"] in not_applicable
            items.append(
                {
                    "id": it["id"],
                    "name": it["name"],
                    "score": None,
                    "max": raw_scale,
                    "status": STATUS_NOT_APPLICABLE if na else STATUS_UNSCORED_BY_MODEL,
                    "evidence": "",
                    "reason": "模型未返回该条目",
                }
            )
        detail_scores[dim_name] = {
            "id": dim.get("id", ""),
            "score": 0,
            "max": dim.get("max", 0),
            "items": items,
            "_injected": True,
        }
        injected.append(dim_name)
        log.warning("missing_dimension_injected", extra={"dimension": dim_name})
    return injected


def _backfill_missing_items(
    detail_scores: dict, rubric: dict, not_applicable: frozenset[str] = frozenset()
) -> list[str]:
    """维度存在但条目缺失时补齐（``unscored_by_model``）——**分母必须来自冻结 rubric**。

    否则模型漏答的条目会同时从分子与分母消失，"漏答"反而变成更高的展示分（docs/19 §3.2 第 4 条）。
    返回被补齐的 ``维度/条目`` 标签，供调用方标记 fallback。
    """
    raw_scale = rubric.get("raw_scale", 3)
    index = rubric_item_index(rubric)
    backfilled: list[str] = []
    for dim_name, dim_data in detail_scores.items():
        if not isinstance(dim_data, dict):
            continue
        expected = index.get(str(dim_name))
        if not expected:
            continue
        present = {str(item.get("id") or "") for item in dim_data.get("items", []) or [] if isinstance(item, dict)}
        items = list(dim_data.get("items", []) or [])
        for item_id, item_name in expected.items():
            if item_id in present:
                continue
            items.append(
                {
                    "id": item_id,
                    "name": item_name,
                    "score": None,
                    "max": raw_scale,
                    "status": STATUS_NOT_APPLICABLE if item_id in not_applicable else STATUS_UNSCORED_BY_MODEL,
                    "evidence": "",
                    "reason": "模型未返回该条目",
                }
            )
            backfilled.append(f"{dim_name}/{item_id}")
        dim_data["items"] = items
    if backfilled:
        log.warning("missing_items_backfilled", extra={"items": backfilled})
    return backfilled


def _validate_scoring_result(result: dict, rubric: dict | None = None, not_applicable: frozenset[str] = frozenset()):
    """最终校验：全字段完整性检查（条目内容问题降级为警告 + 日志）。"""
    _validate_scoring_essentials(result)

    item_errors = _validate_items_content(result.get("detail_scores", {}), not_applicable)
    if item_errors:
        log.warning(
            "评分条目内容校验不通过（降为警告，不阻断评分）",
            extra={"item_errors": item_errors},
        )

    empty_feedback = _normalize_feedback_fields(result)
    if empty_feedback:
        log.warning("反馈字段缺失或类型非法（评分维度不受影响）", extra={"missing_feedback": empty_feedback})

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


def _convert_to_100_scale(result: dict, raw_max: float):
    """展示换算（落库前调用）：把**原始刻度**投影到展示刻度。

    ``raw_max`` 是**本次评分适用的原始满分**（不适用条目已排除）。展示层的维度上限之和
    仍恒为 100，因此既有消费方（分母、颜色）无需改变口径。
    """
    if raw_max <= 0:
        return

    result["total_score"] = apply_score_mapping(result["total_score"], raw_max)

    factor = display_factor(raw_max)

    detail_scores = result.get("detail_scores", {})
    for dim_data in detail_scores.values():
        if isinstance(dim_data, dict):
            dim_data["score"] = round(dim_data.get("score", 0) * factor)
            dim_data["max"] = round(dim_data.get("max", 0) * factor)
            for item in dim_data.get("items", []):
                if isinstance(item, dict):
                    if item.get("score") is None:
                        item["max"] = round(item.get("max", 0) * factor)
                        continue
                    item["score"] = round(item.get("score", 0) * factor)
                    item["max"] = round(item.get("max", 0) * factor)


def raw_view_from_display(detail_scores: dict, raw_max: int, raw_scale: int = 2) -> dict:
    """旧记录（无 ``raw_detail_scores``）的原始条目视图：展示刻度 ÷ 因子 还原。

    只为解释历史数据保留的分支：新记录一律直接读原始层（docs/19 §4.4）。
    """
    factor = display_factor(raw_max)
    out: dict = {}
    if factor <= 0:
        factor = 1.0
    for name, d in detail_scores.items():
        if not isinstance(d, dict):
            continue
        nd = dict(d)
        if isinstance(nd.get("score"), (int, float)):
            nd["score"] = round(nd["score"] / factor)
        items = []
        for it in d.get("items", []) or []:
            if not isinstance(it, dict):
                continue
            ni = dict(it)
            if isinstance(ni.get("score"), (int, float)):
                ni["score"] = round(ni["score"] / factor)
            ni.setdefault("max", raw_scale)
            ni.setdefault("status", STATUS_SCORED)
            items.append(ni)
        nd["items"] = items
        nd["max"] = raw_scale * len(items)
        out[name] = nd
    return out


def review_total_from_raw(detail_raw: dict, applicable_raw_max_value: float, raw_scale: int = 2) -> int:
    """复核总分：原始条目 → Σ → 展示分。恒 ∈ [0, 100]。

    教师复核编辑的是**原始条目**（不改条目直接提交 → Σ 不变 → 总分不变）。
    """
    total = _recalc_total_from_dimensions(detail_raw, raw_scale)
    return apply_score_mapping(total, applicable_raw_max_value)


def sanitize_review_raw(
    detail_raw: dict,
    rubric: dict,
    not_applicable: frozenset[str] = frozenset(),
) -> dict:
    """把教师提交的原始条目收敛到该 rubric 的条目集合与量尺内。

    复核是**成绩写入**，因此这里不沿用"宽容归一"：未知维度/条目直接丢弃（不能凭空
    增大分母或总分），分值钳制到 ``[0, raw_scale]``，病例声明不适用的条目强制为 None。
    """
    raw_scale = rubric.get("raw_scale", 2)
    valid: dict[str, dict[str, str]] = {
        dim["name"]: {it["id"]: it.get("name", "") for it in dim.get("items", [])}
        for dim in rubric.get("dimensions", [])
    }
    out: dict = {}
    for dim_name, dim_data in (detail_raw or {}).items():
        if dim_name not in valid or not isinstance(dim_data, dict):
            continue
        items = []
        for item in dim_data.get("items", []) or []:
            if not isinstance(item, dict):
                continue
            item_id = str(item.get("id") or "")
            if item_id not in valid[dim_name]:
                continue
            if item_id in not_applicable:
                items.append({"id": item_id, "name": valid[dim_name][item_id], "score": None, "max": raw_scale})
                continue
            score = item.get("score")
            if not isinstance(score, (int, float)):
                score = 0
            items.append(
                {
                    "id": item_id,
                    "name": valid[dim_name][item_id],
                    "score": max(0.0, min(float(score), float(raw_scale))),
                    "max": raw_scale,
                }
            )
        out[dim_name] = {"score": sum(it["score"] for it in items if it["score"] is not None), "items": items}
    return out
