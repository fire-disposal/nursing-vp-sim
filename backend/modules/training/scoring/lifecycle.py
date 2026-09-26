"""Scoring lifecycle helpers — shared DB-level coordination functions.

Used by both session.py (end_training) and scoring.py (background worker)
to atomically coordinate scoring state without cross-router imports.
"""

from datetime import UTC, datetime

from sqlalchemy import text

# 本次尝试的登记时刻（`runtime_state` 顶层键）。为什么必须记：`settlement`
# 的 stale 清扫原先只看 `end_time`，于是**对结束已久的记录重试时**，刚置的
# `pending` 会被下一轮清扫立刻打回 `failed` —— 排队的评分 job 随即空跑
# （日志 "评分状态非可执行态 (failed)，跳过执行"）。清扫改按本键衡量新鲜度。
SCORING_REQUESTED_AT_KEY = "scoring_requested_at"


def acquire_scoring(record_id: int, db, allow_retry: bool = False) -> bool:
    # ruff: noqa: S608 — parameterized via :id bound param, no user input concatenated
    status_cond = (
        "scoring_status IS NULL OR scoring_status IN ('completed', 'failed')"
        if allow_retry
        else "status != 'completed' AND scoring_status IS NULL"
    )
    result = db.execute(
        text(
            "UPDATE training_records SET scoring_status = 'pending'"
            + (" , scoring_error = NULL" if allow_retry else "")
            # CAS 与「尝试时刻」必须落在同一条语句里：分两次写会让清扫在中间窗口
            # 看到「pending 无尝试标记」而误判 stale。JSONB 合并只覆盖自己的键，
            # 不整列回写（其余键原样保留，与 patch_runtime_state 的单写者契约一致）。
            + ", runtime_state = coalesce(runtime_state, '{}'::jsonb)"
            # 两个参数都必须显式 cast：jsonb_build_object 的双参数形式在两侧都是占位符时
            # Postgres 推断不出类型（IndeterminateDatatype）。
            " || jsonb_build_object(cast(:marker_key as text), cast(:requested_at as text))"
            # 括号不可省：status_cond 含 OR，而 `AND` 优先级更高 —— 少了括号条件会退化成
            # `(id = :id AND …) OR scoring_status IN ('completed','failed')`，即**重试一条
            # 记录把全库 completed/failed 记录一起置为 pending**（一旦此时重启，job 模式的
            # 启动重放会据此对全库真实记录发起重评分）。claim_scoring 的同款条件自带括号。
             + f" WHERE id = :id AND ({status_cond})"
        ),
        {
            "id": record_id,
            "marker_key": SCORING_REQUESTED_AT_KEY,
            "requested_at": datetime.now(UTC).isoformat(),
        },
    )
    return result.rowcount > 0


def claim_scoring(record_id: int, db) -> bool:
    result = db.execute(
        text(
            "UPDATE training_records SET scoring_status = 'processing' "
            "WHERE id = :id AND (scoring_status = 'pending' OR scoring_status IS NULL)"
        ),
        {"id": record_id},
    )
    return result.rowcount > 0


def release_scoring(record_id: int, db) -> None:
    """Reset scoring_status to NULL — used after QueueFullError rollback."""
    db.execute(
        text("UPDATE training_records SET scoring_status = NULL WHERE id = :id"),
        {"id": record_id},
    )
