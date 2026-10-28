"""版本归因（只读）—— 用**既有数据**回答"哪一版提示词/评分标准/映射曲线产出的分更好"。

设计：（§四 身份按需派生、§五 产品化）。
本模块**不新增存储、不写任何东西**：

* 提示词身份从 ``training_records.prompt_snapshot`` 现算（``prompt_identity``）；
* rubric / 映射曲线身份本来就在 ``scores`` 上（``rubric_version`` / ``mapping_version``）；
* 上下文策略身份在 ``training_records.context_policy_version``（记录创建时冻结；该列之前
  创建的记录为 NULL —— 策略是代码派生的，无法追溯，**不回填**，§四 不变式 3）。

四个维度因此都能查：提示词 / 评分标准 / 分数映射 / 上下文策略。

聚合在 SQL 里完成（GROUP BY 聚合键 + count/sum/min/max），端点不再把记录行拉进内存。
提示词身份是哈希、SQL 无法复算，所以按**快照原文**分组（每组一份，而不是每行一份），
身份仍由 :func:`prompt_id_from_snapshot` 在 Python 里派生 —— 判定只有一处实现。
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime, timedelta
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, Query
from sqlalchemy import JSON, String, func, literal, select
from sqlalchemy.orm import Session  # noqa: TC002 — FastAPI 运行期求值注解，必须真实存在

from core.database import get_db
from core.security import require_permission
from models import Score, TrainingRecord, User
from modules.training.prompt_identity import prompt_id_from_snapshot
from modules.training.scoring.grade_scope import grade_expr

log = logging.getLogger(__name__)

router = APIRouter()

_Manager = Annotated[User, Depends(require_permission("api_manage"))]

#: 归因维度：身份字段 → 该维度"没有身份"时的取值
DIMENSIONS = ("prompt", "rubric", "mapping", "context")
_UNKNOWN = "unknown"

#: 每个维度的 SQL 聚合键：(key_a, key_b)。key_a 承载身份列；key_b 只有 prompt 用得上
#: （workflow_id 参与身份：同样的文本在不同 workflow 下是不同产物），其余维度为常量 NULL。
_KEY_COLUMNS: dict[str, tuple[Any, Any]] = {
    "prompt": (TrainingRecord.prompt_snapshot, TrainingRecord.workflow_id),
    "rubric": (Score.rubric_version, literal(None, String)),
    "mapping": (Score.mapping_version, literal(None, String)),
    "context": (TrainingRecord.context_policy_version, literal(None, String)),
}


def _identity(dimension: str, key_a: Any, key_b: Any) -> str:
    """聚合键 → 身份；取不到就是 ``unknown``（历史记录不伪造身份）。"""
    if dimension == "prompt":
        return prompt_id_from_snapshot(key_a, key_b) or _UNKNOWN
    if dimension == "rubric":
        return key_a or _UNKNOWN
    if dimension == "mapping":
        return f"mapping@{key_a}" if key_a is not None else _UNKNOWN
    if dimension == "context":
        # 记录级冻结值；策略是代码派生的，历史记录（列存在前创建）为 NULL = 不可知
        return key_a or _UNKNOWN
    raise ValueError(f"未知归因维度: {dimension}")


def summarize(groups: list[Any], dimension: str) -> list[dict[str, Any]]:
    """把 SQL 聚合结果按**派生身份**合并成指标行。纯函数（无 DB），便于单测。

    ``groups`` 每行 = 一个聚合键（``key_a``/``key_b``）+ 五个指标
    （``records``/``scored``/``score_sum``/``fallback``/``first_seen``/``last_seen``）。

    不同聚合键可能派生同一个身份（提示词的 v1 扁平与 v2 segments 同文本即同身份），
    所以这里按身份再合并一次：计数相加、首末出现取极值。
    """
    buckets: dict[str, dict[str, Any]] = {}

    for row in groups:
        identity = _identity(dimension, row.key_a, row.key_b)
        bucket = buckets.setdefault(
            identity,
            {
                "identity": identity,
                "records": 0,
                "scored": 0,
                "score_sum": 0.0,
                "fallback": 0,
                "first_seen": None,
                "last_seen": None,
            },
        )
        bucket["records"] += row.records
        bucket["scored"] += row.scored
        bucket["score_sum"] = float(bucket["score_sum"]) + float(row.score_sum or 0.0)
        bucket["fallback"] += row.fallback

        started, latest = row.first_seen, row.last_seen
        if started is not None and (bucket["first_seen"] is None or started < bucket["first_seen"]):
            bucket["first_seen"] = started
        if latest is not None and (bucket["last_seen"] is None or latest > bucket["last_seen"]):
            bucket["last_seen"] = latest

    result: list[dict[str, Any]] = []
    for bucket in buckets.values():
        scored = bucket["scored"]
        result.append(
            {
                "identity": bucket["identity"],
                "records": bucket["records"],
                "scored": scored,
                "avg_score": round(bucket["score_sum"] / scored, 1) if scored else None,
                "fallback_rate": round(bucket["fallback"] / scored, 3) if scored else None,
                "first_seen": bucket["first_seen"].isoformat() if bucket["first_seen"] else None,
                "last_seen": bucket["last_seen"].isoformat() if bucket["last_seen"] else None,
            }
        )
    # 使用量大的排前面；同量按身份名稳定排序
    result.sort(key=lambda row: (-row["records"], row["identity"]))
    return result


def _grouped_query(dimension: str, since: datetime, *, include_failed: bool):
    """按聚合键做一次 GROUP BY：只回聚合值，不回记录行。"""
    key_a, key_b = _KEY_COLUMNS[dimension]
    # 兜底分照算进均值（归因回答的是"这一版实际产出了什么"），兜底率只单独计数。
    statement = (
        select(
            key_a.label("key_a"),
            key_b.label("key_b"),
            func.count(TrainingRecord.id).label("records"),
            func.count(grade_expr()).label("scored"),
            func.coalesce(func.sum(grade_expr()), 0).label("score_sum"),
            func.count().filter(Score.fallback.isnot(None), Score.fallback != JSON.NULL).label("fallback"),
            func.min(TrainingRecord.start_time).label("first_seen"),
            func.max(TrainingRecord.start_time).label("last_seen"),
        )
        .select_from(TrainingRecord)
        .outerjoin(Score, Score.record_id == TrainingRecord.id)
        .where(TrainingRecord.start_time >= since)
        # key_b 只有 prompt 参与分组；其余维度是常量 NULL（常量不必出现在 GROUP BY 里）
        .group_by(*((key_a, key_b) if dimension == "prompt" else (key_a,)))
    )
    if not include_failed:
        statement = statement.where(TrainingRecord.status == "completed")
    return statement


@router.get("/versions/attribution")
def attribution(
    current_user: _Manager,
    db: Annotated[Session, Depends(get_db)],
    by: Annotated[Literal["prompt", "rubric", "mapping", "context"], Query(description="归因维度")] = "prompt",
    window_days: Annotated[int, Query(ge=1, le=730, description="回看天数")] = 90,
    include_failed: Annotated[bool, Query(description="是否纳入未评分记录（只看提示词使用量时有用）")] = True,
) -> dict[str, Any]:
    """按指定维度聚合：记录数 / 已评分数 / 平均分 / 兜底率 / 首末出现。

    窗口按 ``training_records.start_time`` 截取；``unknown`` 桶代表"该维度上身份不可知"
    （历史记录缺快照或未评分），**不回填伪造**。
    """
    since = datetime.now(UTC) - timedelta(days=window_days)
    groups = db.execute(_grouped_query(by, since, include_failed=include_failed)).all()
    items = summarize(list(groups), by)
    return {
        "by": by,
        "window_days": window_days,
        "totals": {
            "records": sum(item["records"] for item in items),
            "identities": len(items),
        },
        "items": items,
    }
