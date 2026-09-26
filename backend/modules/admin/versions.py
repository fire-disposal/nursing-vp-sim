"""版本归因（只读）—— 用**既有数据**回答"哪一版提示词/评分标准/映射曲线产出的分更好"。

设计：docs/ideas/prompt-context-versioning.md（§四 身份按需派生、§五 产品化）。
本模块**不新增存储、不写任何东西**：

* 提示词身份从 ``training_records.prompt_snapshot`` 现算（``prompt_identity``）；
* rubric / 映射曲线身份本来就在 ``scores`` 上（``rubric_version`` / ``mapping_version``）；
* 上下文策略身份是**运行期事实**，历史记录无法追溯 —— 不在这里伪造（§四 不变式 3）。

因此页面能立刻回答"提示词/rubric/映射"三类归因，而"上下文策略"要等捕获落地（P2）。
"""

from __future__ import annotations

import logging
from collections import defaultdict
from datetime import UTC, datetime, timedelta
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session  # noqa: TC002 — FastAPI 运行期求值注解，必须真实存在

from core.database import get_db
from core.security import require_permission
from models import Score, TrainingRecord, User
from modules.training.prompt_identity import prompt_id_from_snapshot

log = logging.getLogger(__name__)

router = APIRouter()

_Manager = Annotated[User, Depends(require_permission("api_manage"))]

#: 归因维度：身份字段 → 该维度"没有身份"时的取值
DIMENSIONS = ("prompt", "rubric", "mapping")
_UNKNOWN = "unknown"

#: 单次查询的记录上限：归因是运维读面，不能因为窗口过大把库拖垮
MAX_RECORDS = 20000


def _identity_for(dimension: str, record: TrainingRecord, score: Score | None) -> str:
    """取某维度上的身份；取不到就是 ``unknown``（历史记录不伪造身份）。"""
    if dimension == "prompt":
        return prompt_id_from_snapshot(record.prompt_snapshot, record.workflow_id) or _UNKNOWN
    if dimension == "rubric":
        if score is None or not score.rubric_version:
            return _UNKNOWN
        return score.rubric_version
    if dimension == "mapping":
        return f"mapping@{score.mapping_version}" if score is not None else _UNKNOWN
    raise ValueError(f"未知归因维度: {dimension}")


def summarize(rows: list[tuple[TrainingRecord, Score | None]], dimension: str) -> list[dict[str, Any]]:
    """按身份聚合。纯函数（无 DB），便于单测。

    ``rows`` = [(record, score|None)]。指标刻意保持可解释：
    记录数、已评分记录数、平均分（仅计有效成绩）、兜底率、首次/最近出现。
    """
    buckets: dict[str, dict[str, Any]] = defaultdict(
        lambda: {
            "identity": "",
            "records": 0,
            "scored": 0,
            "score_sum": 0.0,
            "fallback": 0,
            "first_seen": None,
            "last_seen": None,
        }
    )

    for record, score in rows:
        identity = _identity_for(dimension, record, score)
        bucket = buckets[identity]
        bucket["identity"] = identity
        bucket["records"] += 1

        started = record.start_time
        if started is not None:
            if bucket["first_seen"] is None or started < bucket["first_seen"]:
                bucket["first_seen"] = started
            if bucket["last_seen"] is None or started > bucket["last_seen"]:
                bucket["last_seen"] = started

        if score is None:
            continue
        effective = score.effective_total
        if effective is not None:
            bucket["scored"] += 1
            bucket["score_sum"] += float(effective)
        if score.fallback:
            bucket["fallback"] += 1

    result: list[dict[str, Any]] = []
    for bucket in buckets.values():
        scored = bucket["scored"]
        records = bucket["records"]
        result.append(
            {
                "identity": bucket["identity"],
                "records": records,
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


@router.get("/versions/attribution")
def attribution(
    current_user: _Manager,
    db: Annotated[Session, Depends(get_db)],
    by: Annotated[Literal["prompt", "rubric", "mapping"], Query(description="归因维度")] = "prompt",
    window_days: Annotated[int, Query(ge=1, le=730, description="回看天数")] = 90,
    include_failed: Annotated[bool, Query(description="是否纳入未评分记录（只看提示词使用量时有用）")] = True,
) -> dict[str, Any]:
    """按指定维度聚合：记录数 / 已评分数 / 平均分 / 兜底率 / 首末出现。

    窗口按 ``training_records.start_time`` 截取；``unknown`` 桶代表"该维度上身份不可知"
    （历史记录缺快照或未评分），**不回填伪造**。
    """
    since = datetime.now(UTC) - timedelta(days=window_days)
    query = (
        db.query(TrainingRecord, Score)
        .outerjoin(Score, Score.record_id == TrainingRecord.id)
        .filter(TrainingRecord.start_time >= since)
        .order_by(TrainingRecord.start_time.desc())
    )
    if not include_failed:
        query = query.filter(TrainingRecord.status == "completed")

    # 显式物化为 tuple：SQLAlchemy 的 Row 支持解包但不是 tuple 类型，直接标注会与类型检查冲突
    rows: list[tuple[TrainingRecord, Score | None]] = [
        (record, score) for record, score in query.limit(MAX_RECORDS).all()
    ]
    items = summarize(rows, by)
    return {
        "by": by,
        "window_days": window_days,
        "truncated": len(rows) >= MAX_RECORDS,
        "totals": {
            "records": len(rows),
            "identities": len(items),
        },
        "items": items,
    }
