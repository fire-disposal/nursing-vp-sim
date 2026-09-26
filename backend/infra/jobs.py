"""持久化 Job 的认领、心跳与执行（docs/ideas/pipeline-and-job-separation.md）。

为什么需要租约而不是"连接活着就算活着"：发版、OOM、`docker kill` 都会让执行者无声消失。
租约 + 心跳把"执行者是否还在"变成一行可查询的事实，过期即可被重领，且失败原因有据可查。

同步 DB 调用一律经 ``asyncio.to_thread`` 出循环：本仓的 Session 是同步的，
直接放在事件循环里会阻塞 chat SSE（见 docs/17 与 2026-07-26 事故）。
"""

from __future__ import annotations

import asyncio
import logging
import os
import socket
from typing import Any

from sqlalchemy import text

from core.config import (
    JOB_HEARTBEAT_SECONDS,
    JOB_LEASE_SECONDS,
    JOB_MAX_ATTEMPTS,
    JOB_POLL_INTERVAL_SECONDS,
    JOB_RETRY_BACKOFF_CAP_SECONDS,
    JOB_RETRY_BACKOFF_SECONDS,
    SCORING_WORKERS,
)
from core.database import SessionLocal
from models import JOB_KIND_SCORING, JOB_STATUS_FAILED, JOB_STATUS_PENDING

log = logging.getLogger(__name__)

_CLAIM_SQL = text(
    """
    UPDATE jobs
       SET status = 'running',
           lease_owner = :owner,
           lease_expires_at = now() + make_interval(secs => :lease),
           attempts = attempts + 1,
           updated_at = now()
     WHERE id = (
         SELECT id FROM jobs
          WHERE status = 'pending' AND available_at <= now()
          ORDER BY priority DESC, id
          FOR UPDATE SKIP LOCKED
          LIMIT 1
     )
    RETURNING id, kind, record_id, payload, attempts, max_attempts
    """
)

_HEARTBEAT_SQL = text(
    """
    UPDATE jobs
       SET lease_expires_at = now() + make_interval(secs => :lease), updated_at = now()
     WHERE id = :job_id AND lease_owner = :owner AND status = 'running'
    """
)

_SUCCEED_SQL = text(
    """
    UPDATE jobs
       SET status = 'succeeded', lease_owner = NULL, lease_expires_at = NULL, updated_at = now()
     WHERE id = :job_id AND status = 'running'
    """
)

#: 未耗尽尝试 → 退回 pending 并延后到退避时刻；耗尽 → 终态 failed。返回最终状态。
_FAIL_SQL = text(
    """
    UPDATE jobs
       SET status = CASE WHEN attempts >= max_attempts THEN 'failed' ELSE 'pending' END,
           available_at = CASE
               WHEN attempts >= max_attempts THEN available_at
               ELSE now() + make_interval(secs => :retry_in)
           END,
           last_error = :error,
           lease_owner = NULL,
           lease_expires_at = NULL,
           updated_at = now()
     WHERE id = :job_id
    RETURNING status
    """
)

#: 租约过期 = 执行者已消失。未耗尽尝试 → 可重领；耗尽 → 终态 failed。
_RECLAIM_SQL = text(
    """
    UPDATE jobs
       SET status = CASE WHEN attempts >= max_attempts THEN 'failed' ELSE 'pending' END,
           last_error = coalesce(last_error, 'lease expired (executor gone)'),
           lease_owner = NULL,
           lease_expires_at = NULL,
           updated_at = now()
     WHERE status = 'running' AND lease_expires_at < now()
    RETURNING status
    """
)

_STATS_SQL = text(
    """
    SELECT kind,
           status,
           count(*) AS n,
           coalesce(max(extract(epoch FROM now() - created_at)) FILTER (WHERE status = 'pending'), 0) AS oldest_pending_s
      FROM jobs
     GROUP BY kind, status
    """
)


def job_owner(role: str = "inline") -> str:
    """执行者标识：``{role}:{host}:{pid}``。进程重启即换新标识，旧租约自然过期。"""
    return f"{role}:{socket.gethostname()}:{os.getpid()}"


def backoff_seconds(attempts: int) -> int:
    """第 ``attempts`` 次失败后的等待秒数（指数退避，带上限）。

    ``attempts`` 是**已发生的尝试次数**（认领时自增），因此第一次失败 = 1 → 基数。
    """
    if attempts < 1:
        return 0
    raw = JOB_RETRY_BACKOFF_SECONDS * (2 ** (attempts - 1))
    return min(raw, JOB_RETRY_BACKOFF_CAP_SECONDS)


# ── 同步操作（调用方负责把它们放进 to_thread）──


def enqueue(
    db, *, kind: str, record_id: int | None = None, payload: dict | None = None, priority: int = 0
) -> int | None:
    """登记一条 job；同一记录已有挂起任务时返回 None（结构性去重，不报错）。

    刻意不抛异常：记录自身的 ``scoring_status`` 才是执行期仲裁者，这条索引只是防御重复入队；
    把"已有挂起任务"当成错误会迫使每个调用点再写一套处理，而它并不改变最终结果。
    """
    row = db.execute(
        text(
            """
            INSERT INTO jobs (kind, record_id, payload, priority, max_attempts)
            VALUES (:kind, :record_id, coalesce(:payload, '{}'::jsonb), :priority, :max_attempts)
            ON CONFLICT DO NOTHING
            RETURNING id
            """
        ),
        {
            "kind": kind,
            "record_id": record_id,
            "payload": payload,
            "priority": priority,
            "max_attempts": JOB_MAX_ATTEMPTS,
        },
    ).first()
    return int(row[0]) if row else None


def claim(db, *, owner: str) -> dict[str, Any] | None:
    """认领一条可执行 job；没有则返回 None。"""
    row = db.execute(_CLAIM_SQL, {"owner": owner, "lease": JOB_LEASE_SECONDS}).first()
    if row is None:
        return None
    return {
        "id": int(row.id),
        "kind": row.kind,
        "record_id": row.record_id,
        "payload": row.payload or {},
        "attempts": int(row.attempts),
        "max_attempts": int(row.max_attempts),
    }


def heartbeat(db, *, job_id: int, owner: str) -> bool:
    """续租；返回 False 表示租约已不属于本执行者（应停止执行）。"""
    result = db.execute(_HEARTBEAT_SQL, {"job_id": job_id, "owner": owner, "lease": JOB_LEASE_SECONDS})
    return bool(result.rowcount)


def mark_succeeded(db, *, job_id: int) -> None:
    db.execute(_SUCCEED_SQL, {"job_id": job_id})


def mark_failed(db, *, job_id: int, error: str, attempts: int) -> str:
    """记录失败；返回最终状态（``pending`` = 已按退避重排，``failed`` = 终态）。"""
    row = db.execute(
        _FAIL_SQL,
        {"job_id": job_id, "error": error[:2000], "retry_in": backoff_seconds(attempts)},
    ).first()
    return str(row[0]) if row else JOB_STATUS_FAILED


def reclaim_expired(db) -> dict[str, int]:
    """把租约过期的 running 任务退回 pending（或耗尽尝试则终态 failed）。"""
    rows = db.execute(_RECLAIM_SQL).all()
    counts = {JOB_STATUS_PENDING: 0, JOB_STATUS_FAILED: 0}
    for row in rows:
        counts[str(row[0])] = counts.get(str(row[0]), 0) + 1
    return counts


def stats(db) -> list[dict[str, Any]]:
    """按 kind/status 汇总（运维读面；``python -m infra.jobs`` 也用它）。"""
    return [
        {
            "kind": row.kind,
            "status": row.status,
            "count": int(row.n),
            "oldest_pending_seconds": int(row.oldest_pending_s or 0),
        }
        for row in db.execute(_STATS_SQL).all()
    ]


# ── 执行循环 ──


async def _run_sync(fn, *args, **kwargs):
    """把同步 DB 操作移出事件循环。"""
    return await asyncio.to_thread(fn, *args, **kwargs)


async def _execute_scoring(app_state, job: dict[str, Any]) -> None:
    """执行一条评分 job：输入由记录派生（payload 不存副本，见 docs/17 §四）。"""
    from modules.training.scoring.runner import ScoringNotExecuted, run_scoring_background

    record_id = job["record_id"]
    if record_id is None:
        raise ValueError(f"scoring job {job['id']} 缺少 record_id")

    def _case_data() -> dict:
        from models import Case, TrainingRecord

        with SessionLocal() as db:
            record = db.query(TrainingRecord).filter(TrainingRecord.id == record_id).first()
            if record is None:
                return {}
            case = db.query(Case).filter(Case.id == record.case_id).first()
            return record.case_snapshot or (case.case_data if case else {}) or {}

    case_data = await asyncio.to_thread(_case_data)
    skip_reason = await run_scoring_background(
        record_id,
        case_data,
        llm_client=app_state.llm_client,
        tracker=getattr(app_state, "scoring_tracker", None),
        realtime_hub=getattr(app_state, "realtime_hub", None),
    )
    if skip_reason:
        # 未执行 ≠ 成功：异常是执行器既有的失败记账通道（``_execute_claimed``），
        # 不抛就会把这条 job 记成 succeeded —— 队列读面于是显示"评分作业成功"
        # 而 scores 里没有分。
        raise ScoringNotExecuted(skip_reason)


_EXECUTORS = {JOB_KIND_SCORING: _execute_scoring}


async def _execute_claimed(app_state, job: dict[str, Any], owner: str) -> None:
    """执行 + 心跳 + 结算。异常一律落到 job 记录，不再往上抛（单条 job 失败不影响循环）。"""
    executor = _EXECUTORS.get(job["kind"])
    if executor is None:
        await _run_sync(_fail_job, job, f"未知 job kind: {job['kind']}")
        return

    stop = asyncio.Event()

    async def _heartbeat_loop() -> None:
        while not stop.is_set():
            try:
                await asyncio.wait_for(stop.wait(), timeout=JOB_HEARTBEAT_SECONDS)
                return
            except TimeoutError:
                pass
            kept = await _run_sync(_heartbeat_job, job["id"], owner)
            if not kept:
                log.warning("job %s 租约已易主，停止执行（本进程不再写入结果）", job["id"])
                return

    hb = asyncio.create_task(_heartbeat_loop())
    try:
        await executor(app_state, job)
    except Exception as exc:  # 单条 job 的任何异常都必须变成 job 失败，而不是循环崩溃
        log.exception("job %s 执行失败", job["id"])
        await _run_sync(_fail_job, job, f"{type(exc).__name__}: {exc}")
    else:
        await _run_sync(_succeed_job, job["id"])
    finally:
        stop.set()
        await hb


def _heartbeat_job(job_id: int, owner: str) -> bool:
    with SessionLocal() as db:
        kept = heartbeat(db, job_id=job_id, owner=owner)
        db.commit()
        return kept


def _succeed_job(job_id: int) -> None:
    with SessionLocal() as db:
        mark_succeeded(db, job_id=job_id)
        db.commit()


def _fail_job(job: dict[str, Any], error: str) -> None:
    with SessionLocal() as db:
        status = mark_failed(db, job_id=job["id"], error=error, attempts=job["attempts"])
        db.commit()
    log.warning(
        "job %s 失败 → %s（第 %d/%d 次）: %s", job["id"], status, job["attempts"], job["max_attempts"], error[:200]
    )


async def _worker_loop(app_state, owner: str) -> None:
    """一个执行槽位：认领→执行→重试/结算；空闲时按轮询间隔休眠。"""
    while True:
        job = await _run_sync(_claim_or_none, owner)
        if job is None:
            await asyncio.sleep(JOB_POLL_INTERVAL_SECONDS)
            continue
        await _execute_claimed(app_state, job, owner)


def _claim_or_none(owner: str) -> dict[str, Any] | None:
    with SessionLocal() as db:
        reclaimed = reclaim_expired(db)
        job = claim(db, owner=owner)
        db.commit()
    if any(reclaimed.values()):
        log.info(
            "租约恢复：退回避重领 %d / 终态失败 %d",
            reclaimed.get(JOB_STATUS_PENDING, 0),
            reclaimed.get(JOB_STATUS_FAILED, 0),
        )
    return job


async def run_loop(app_state, *, role: str = "inline", concurrency: int | None = None) -> None:
    """启动 job 执行槽位（``SCORING_EXECUTION=job`` 时由 bootstrap 调用）。"""
    owner = job_owner(role)
    slots = concurrency or SCORING_WORKERS
    log.info("Job 执行器启动: owner=%s slots=%d lease=%ds", owner, slots, JOB_LEASE_SECONDS)
    await asyncio.gather(*(_worker_loop(app_state, owner) for _ in range(slots)))


def _cli() -> None:
    """``python -m infra.jobs`` —— 打印队列现状（切换前后核对用）。"""
    import json

    with SessionLocal() as db:
        print(json.dumps(stats(db), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    _cli()
