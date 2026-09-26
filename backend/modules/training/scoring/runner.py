"""评分执行管道 —— 后台任务体、唯一入队边界、失败/快照恢复、卡住记录分类。

HTTP 层（``router/scoring.py``）只负责触发与查询；执行本身住在这里：

* ``enqueue_scoring`` —— 所有评分触发点的**唯一入队边界**（启动重放、``/end``、
  ``retry-scoring``、患者走人、结算自动结算）。它把 ``record_id``/``case_data``
  捕获为标量（闭包在 worker 阶段不回读 ORM 属性），并在队列满时抛
  ``QueueFullError``；各触发点保留自己的恢复策略（HTTP 回滚 503 / 走人交给
  结算清扫 / 结算重开记录 / 启动告警）。
* ``run_scoring_background`` —— TaskQueue worker 中执行的评分任务体。
* ``handle_scoring_failure`` / 快照往返 —— 失败终态策略（含 force 重评恢复）。
* ``classify_stuck_records`` —— 卡在 ``pending``/``processing`` 的记录的唯一分类器，
  启动恢复（``main.py:_recover_stuck_scoring_records``）与结算清扫
  （``session/settlement.py:_sweep_stale_scoring_records``）共用同一判定。
"""

import asyncio
import logging
from collections.abc import Sequence
from enum import StrEnum

from sqlalchemy.orm import Session

from core.config import (
    SCORING_EXECUTION,
    SCORING_RETRY_DELAY_SECONDS,
    SCORING_TIMEOUT_SECONDS,
)
from core.database import SessionLocal
from core.statuses import ScoringStatus
from infra.llm.client import LLMClient
from infra.scoring_progress import ScoringProgressTracker

# NOTE: ScoringProgressTracker 是内存 dict — 仅适合作业内暂存。
# 多 worker 下会各自独立，不影响功能（UI 轮询走当前 worker）。
from models import JOB_KIND_SCORING, Message, Notification, Score, ScoreReview, TrainingRecord
from modules.training.session.finalize import mark_discarded, student_message_count
from modules.training.session.state import patch_runtime_state
from modules.training.workflows import workflow_for_record

from .engine import evaluate_training
from .lifecycle import claim_scoring

log = logging.getLogger(__name__)

#: 评分任务的队列优先级 —— 所有触发点共用（原先五处各写一遍 priority=5）。
SCORING_PRIORITY = 5


class ScoringNotExecuted(RuntimeError):
    """本次作业没有执行评分（记录不存在 / 状态不可执行）。

    由 job 执行器接住并记为失败：``run_scoring_background`` 正常返回被当作
    ``succeeded``，会让"队列里有一条成功的评分作业"与"库里没有分"同时成立 ——
    运维面（``jobs`` 块）据此会误报健康。
    """


# ── 卡住记录分类（启动恢复 / 结算清扫的唯一判定） ──


class StuckRecordOutcome(StrEnum):
    """卡在 ``pending``/``processing`` 的评分记录的终态分类。

    * ``COMPLETED`` —— 已落 ``Score``：终态必须是 ``completed``
      （"有 Score ⇒ completed" 不变量；Score 已可见，标 failed 就是孤儿分）。
    * ``DISCARDED`` —— 无学生消息：不可评分，也不该发失败通知。
    * ``UNSCORED`` —— 有学生消息但无分：本次评分任务没有结果。
    """

    COMPLETED = "completed"
    DISCARDED = "discarded"
    UNSCORED = "unscored"


def _scored_record_ids(db: Session, record_ids: Sequence[int]) -> set[int]:
    return {row[0] for row in db.query(Score.record_id).filter(Score.record_id.in_(record_ids)).all()}


def _record_ids_with_student_messages(db: Session, record_ids: Sequence[int]) -> set[int]:
    return {
        row[0]
        for row in db.query(Message.record_id)
        .filter(Message.record_id.in_(record_ids), Message.role == "student")
        .all()
    }


def classify_stuck_records(db: Session, records: Sequence[TrainingRecord]) -> dict[int, StuckRecordOutcome]:
    """卡住评分记录的唯一分类器（批量，两查一算）。

    优先级：已落 Score 胜过一切（``COMPLETED``）——分已产生就必须可见；其次是
    无学生消息（``DISCARDED``）；否则为 ``UNSCORED``，由调用方按自己的策略落终态：

    * 启动恢复把 ``UNSCORED`` 置回 ``pending`` 重新入队 —— 上一个进程崩溃时内存队列
      里的任务从未执行，重跑是唯一正确的恢复；
    * 结算清扫把超龄 ``UNSCORED`` 标 ``failed`` 并通知 —— 任务在本进程内 10 分钟无进展，
      不再自动重跑（避免故障期每 10 分钟循环烧 LLM 预算），改由用户手动重试。

    两者年龄/意图确实不同（无存活任务 vs. 任务疑似存活），故保留该终态差异
    （见 docs/01-architecture.md §评分流程）。
    """
    record_ids = [record.id for record in records]
    if not record_ids:
        return {}
    scored = _scored_record_ids(db, record_ids)
    with_student = _record_ids_with_student_messages(db, record_ids)
    outcomes: dict[int, StuckRecordOutcome] = {}
    for record_id in record_ids:
        if record_id in scored:
            outcomes[record_id] = StuckRecordOutcome.COMPLETED
        elif record_id in with_student:
            outcomes[record_id] = StuckRecordOutcome.UNSCORED
        else:
            outcomes[record_id] = StuckRecordOutcome.DISCARDED
    return outcomes


def resolve_terminal_status(db: Session, record_id: int, *, intended: str) -> str:
    """若记录已存在有效 Score，则终态强制为 'completed'，避免孤儿 Score + failed。

    intended 为调用方本想设置的终态（通常 'failed'）。仅当无 Score 时才沿用。
    与 ``classify_stuck_records`` 的 ``COMPLETED`` 分支是同一条不变量的同一次判定。
    """
    if _scored_record_ids(db, [record_id]):
        return ScoringStatus.COMPLETED
    return intended


# force 重评快照的字段集合 —— 快照/恢复两侧的唯一真相。
# 字段漏在任一侧都会静默丢数据（dim_total/reviewed_at 曾因此丢失）。
SCORE_SNAPSHOT_FIELDS = (
    "total_score",
    "detail_scores",
    "strengths",
    "weaknesses",
    "missed_content",
    "suggestions",
    "rubric_version",
    "model_name",
    "prompt_schema_version",
    "raw_total",
    "mapping_version",
    "fallback",
    "dim_total",
    "reviewed_total",
    "reviewed_at",
)
SCORE_REVIEW_SNAPSHOT_FIELDS = ("reviewed_by", "detail_scores", "total_score", "comment")


def missing_snapshot_updates(record) -> dict:
    """需要补写的**缺失**快照字段；已有值一律不动。

    SCR-7（docs/review/tech-debt-audit-2026-09-14.md）：旧实现用
    ``if not prompt_snapshot or not rubric_snapshot`` 触发，却在块内**无条件**重写两者 ——
    只缺 rubric 的旧记录会被顺手改成"今天"的提示词，事后审计/回放/归因全部失真且无日志。
    这里逐字段独立判定：冻结过的东西永不回写（docs/17 §2.4）。

    返回 ``{字段名: 新值}``；两个快照都在时返回空 dict（且不解析 workflow）。
    """
    if record.prompt_snapshot and record.rubric_snapshot:
        return {}

    from modules.training.scoring.rubric import build_final_rubric

    workflow = workflow_for_record(record)
    updates: dict = {}
    if not record.prompt_snapshot:
        updates["prompt_snapshot"] = {
            "schema_version": 2,
            "segments": {
                "system": workflow.prompts.system,
                "dynamic": workflow.prompts.dynamic,
            },
        }
    if not record.rubric_snapshot:
        features = (record.practice_snapshot or {}).get("features", {})
        updates["rubric_snapshot"] = build_final_rubric(workflow.rubric, features)
    return updates


def snapshot_score_for_rescore(score: Score, review: ScoreReview | None) -> dict:
    """快照旧分/旧复核，供 force 重评失败时恢复。"""
    return {
        "score": {field: getattr(score, field) for field in SCORE_SNAPSHOT_FIELDS},
        "review": (
            {field: getattr(review, field) for field in SCORE_REVIEW_SNAPSHOT_FIELDS} if review is not None else None
        ),
    }


def restore_score_from_snapshot(snapshot: dict, record_id: int) -> tuple[Score, ScoreReview | None] | None:
    """从快照重建 Score/ScoreReview；快照无分数时返回 None。"""
    old = snapshot.get("score")
    if not old:
        return None
    score = Score(record_id=record_id, **{field: old.get(field) for field in SCORE_SNAPSHOT_FIELDS})
    review_snapshot = snapshot.get("review")
    review = (
        ScoreReview(score=score, **{field: review_snapshot.get(field) for field in SCORE_REVIEW_SNAPSHOT_FIELDS})
        if review_snapshot
        else None
    )
    return score, review


# Scoring 生成控制：使用 DB 的 scoring_status 作为唯一仲裁者。
# 弃用进程内 generation dict（多 worker 下不安全）。
# 每个任务在写入终态前校验 scoring_status 是否仍是 "processing"。


def create_notification(
    db: Session,
    *,
    user_id: int,
    record_id: int | None,
    type: str,
    title: str,
    body: str,
) -> None:
    """Create a user notification in its own transaction. Never raises."""
    try:
        db.add(
            Notification(
                user_id=user_id,
                record_id=record_id,
                type=type,
                title=title,
                body=body,
            )
        )
        db.flush()
    except Exception:
        db.rollback()
        log.warning("Failed to create notification (type=%s)", type, exc_info=True)


async def publish_scoring_event(realtime_hub, user_id: int, event: str, payload: dict) -> None:
    """Publish an SSE event, swallowing transport errors."""
    if not realtime_hub:
        return
    try:
        await realtime_hub.publish(user_id, event, payload)
    except Exception:
        log.warning("SSE publish failed (event=%s)", event, exc_info=True)


def handle_scoring_failure(
    record_id: int,
    error_msg: str,
    tracker: ScoringProgressTracker | None = None,
    realtime_hub=None,
    user_id: int | None = None,
) -> None:
    """Shared error handling — updates DB status, creates notification, publishes SSE."""
    try:
        db = SessionLocal()
        try:
            db.expire_all()
            record = db.query(TrainingRecord).filter(TrainingRecord.id == record_id).first()
            if record and record.scoring_status == ScoringStatus.PROCESSING:
                terminal = resolve_terminal_status(db, record_id, intended=ScoringStatus.FAILED)
                record.scoring_status = terminal
                record.scoring_error = None if terminal == ScoringStatus.COMPLETED else error_msg[:2000]
                db.commit()
                if terminal == ScoringStatus.COMPLETED:
                    log.info("评分超时但已存在有效 Score，纠正为 completed", extra={"record_id": record_id})
                    return
                # S6 两阶段 force 重评：新评分失败 → 从 runtime_state 快照恢复旧分/旧复核
                snapshot = dict(record.runtime_state or {}).get("force_rescore_snapshot")
                if snapshot and not db.query(Score).filter(Score.record_id == record_id).first():
                    rebuilt = restore_score_from_snapshot(snapshot, record_id)
                    if rebuilt is not None:
                        restored, restored_review = rebuilt
                        db.add(restored)
                        db.flush()
                        if restored_review is not None:
                            db.add(restored_review)
                        # 只清自己拥有的键（session/state.py 的写入契约）：整列回写会
                        # 抹掉这期间工具/对话写入的 runtime_state 键。
                        patch_runtime_state(db, record_id, remove=["force_rescore_snapshot"])
                        # 有 Score ⇒ completed（本文件唯一实现该不变量的地方）：
                        # 只恢复分不纠正状态，恢复出的旧分会在成绩管理/作业详情永久不可见。
                        record.scoring_status = ScoringStatus.COMPLETED
                        record.scoring_error = None
                        db.commit()
                        log.warning("force rescore 失败，已恢复旧分", extra={"record_id": record_id})
                        return
                actual_user_id = user_id or record.user_id
                create_notification(
                    db,
                    user_id=actual_user_id,
                    record_id=record.id,
                    type="scoring_failed",
                    title="评分失败",
                    body=f"评分失败：{error_msg[:100] or '未知错误'}",
                )
                db.commit()
                if realtime_hub:
                    asyncio.ensure_future(  # noqa: RUF006
                        publish_scoring_event(
                            realtime_hub,
                            actual_user_id,
                            "scoring_failed",
                            {"record_id": record.id, "error": error_msg[:100] or "未知错误"},
                        )
                    )
        finally:
            db.close()
    except Exception as inner:
        log.exception("评分失败后状态更新失败", extra={"record_id": record_id, "error": str(inner)})


async def run_scoring_background(
    record_id: int,
    case_data: dict,
    *,
    llm_client: LLMClient,
    tracker: ScoringProgressTracker | None = None,
    realtime_hub=None,
) -> str | None:
    """评分任务体。返回 ``None`` = 本次已执行（含"无学生消息→discard"的终态处置）；
    返回字符串 = **未执行**的原因（记录不存在 / 状态非可执行态）。

    为什么要返回原因而不是静默 return：job 执行器把"正常返回"记为 ``succeeded``，
    于是「作业成功但没有任何评分」会在运维面上表现为健康 —— 队列读面（``jobs`` 块）
    拿不到真实结论。jobs 层据本返回值把未执行判为失败。
    """
    SCORING_GLOBAL_TIMEOUT = SCORING_TIMEOUT_SECONDS

    db = SessionLocal()
    log.info("[SCORING] START record_id=%d timeout=%ds", record_id, SCORING_GLOBAL_TIMEOUT)
    try:
        record = db.query(TrainingRecord).filter(TrainingRecord.id == record_id).first()
        if not record:
            log.warning("评分任务：记录不存在", extra={"record_id": record_id})
            return f"记录 {record_id} 不存在"
        log.info("评分任务开始", extra={"record_id": record_id, "scoring_status": record.scoring_status})
        # 原子性认领：仅当记录处于可执行态才继续。
        # 'pending'  — end_training / retry_scoring / triage 经 acquire_scoring 获取；
        # NULL       — settlement 自动结算路径（未走 acquire）。
        # UPDATE 的 rowcount 保证并发重复入队时只有一个 worker 认领成功（幂等）。
        claimed = claim_scoring(record_id, db)
        db.commit()
        if not claimed:
            db.refresh(record)
            status = record.scoring_status
            if status == ScoringStatus.COMPLETED:
                # 已被其他执行者评完：本条 job 的目的已达成，不是失败。
                log.info("评分已由其他执行者完成，本条跳过", extra={"record_id": record_id})
                return None
            log.warning("评分状态非可执行态 (%s)，跳过执行", status, extra={"record_id": record_id})
            return f"记录非可执行态（scoring_status={status}）"

        db.refresh(record)

        # No student turn means there is no assessable nursing behavior.
        # Treat it as discarded, not as failed scoring and not as a zero score.
        if student_message_count(db, record_id) == 0:
            log.info("评分跳过：无学生消息 record_id=%d", record_id)
            mark_discarded(db, record)
            db.commit()
            return None

        # 存量记录兼容：只补**缺失**的快照字段（新记录已在 _create_record 固化）
        try:
            updates = missing_snapshot_updates(record)
            if updates:
                for field, value in updates.items():
                    setattr(record, field, value)
                db.commit()
        except AttributeError:
            pass

        if tracker:
            tracker.start(record_id)

        async def _attempt_evaluate():
            await asyncio.wait_for(
                evaluate_training(
                    record_id,
                    case_data,
                    db,
                    llm_client=llm_client,
                    tracker=tracker,
                    realtime_hub=realtime_hub,
                    user_id=record.user_id,
                ),
                timeout=SCORING_GLOBAL_TIMEOUT,
            )

        async def _attempt_with_retry():
            """单次尝试 + 非超时失败重试一次。

            整个序列（含 30s 重试间隔）受 SCORING_GLOBAL_TIMEOUT 约束：
            任务总时长 ≤ SCORING_TIMEOUT_SECONDS < SCORING_RETRY_GRACE_SECONDS，
            否则重试序列（2×180s+30s ≈ 390s）会超出 210s 重试守卫窗口，
            出现"旧任务仍在跑却被 retry_scoring 抢占"的错配。
            """
            try:
                await _attempt_evaluate()
            except TimeoutError:
                raise
            except Exception as first_error:
                log.warning(
                    "[SCORING] retrying once record_id=%d after %s: %s",
                    record_id,
                    type(first_error).__name__,
                    str(first_error)[:200],
                )
                if SCORING_RETRY_DELAY_SECONDS > 0:
                    await asyncio.sleep(SCORING_RETRY_DELAY_SECONDS)
                await _attempt_evaluate()

        await asyncio.wait_for(_attempt_with_retry(), timeout=SCORING_GLOBAL_TIMEOUT)

        # Re-fetch record.  Only skip completion if a *newer* retry was explicitly
        # triggered (status='pending' via acquire_scoring).  If settlement sweep
        # changed status to 'failed' during scoring, we must still set 'completed'
        # because a Score was just saved — otherwise we get an orphan Score.
        db.refresh(record)
        if record.scoring_status == ScoringStatus.PENDING:
            log.info("评分被新重试请求取代，跳过完成状态更新", extra={"record_id": record_id})
            return None
        if record.scoring_status != ScoringStatus.PROCESSING:
            log.info("评分状态已变更（%s），跳过完成状态更新", record.scoring_status, extra={"record_id": record_id})
            return None

        record.scoring_status = ScoringStatus.COMPLETED
        record.scoring_error = None
        if tracker:
            tracker.update(record_id, ScoringStatus.COMPLETED, 100, "评分完成")
        log.info("[SCORING] DONE record_id=%d", record_id)

        score_obj = db.query(Score).filter(Score.record_id == record_id).first()
        has_fallback = bool(score_obj and score_obj.fallback)
        create_notification(
            db,
            user_id=record.user_id,
            record_id=record.id,
            type="scoring_complete",
            title="评分已完成",
            body=("训练评分已完成（评分异常，已标记，请查看详情）" if has_fallback else "训练评分已完成，请查看详情"),
        )
        db.commit()

        await publish_scoring_event(
            realtime_hub,
            record.user_id,
            "scoring_complete",
            {
                "record_id": record.id,
                "total_score": score_obj.total_score if score_obj else None,
                "fallback": bool(score_obj and score_obj.fallback),
            },
        )
    except TimeoutError:
        log.exception("[SCORING] TIMEOUT record_id=%d", record_id)
        # 实际触发点是最内层 LLM 客户端超时（profile timeout + 10s），
        # 而非 SCORING_TIMEOUT_SECONDS 全局值——不写具体秒数避免误导。
        _timeout_msg = "评分超时"
        if tracker:
            tracker.update(record_id, ScoringStatus.FAILED, 0, _timeout_msg)
        handle_scoring_failure(
            record_id,
            _timeout_msg,
            tracker=tracker,
            realtime_hub=realtime_hub,
        )
    except Exception as e:
        msg = str(e)[:200]
        log.exception("[SCORING] FAIL record_id=%d error=%s: %s", record_id, type(e).__name__, msg)
        if tracker:
            tracker.update(record_id, ScoringStatus.FAILED, 0, msg)
        handle_scoring_failure(
            record_id,
            str(e)[:2000] or type(e).__name__,
            tracker=tracker,
            realtime_hub=realtime_hub,
        )
    finally:
        db.close()
        if tracker:
            tracker.cleanup(record_id)


async def enqueue_scoring(
    app_state,
    record_id: int,
    case_data: dict | None,
    *,
    priority: int = SCORING_PRIORITY,
) -> None:
    """评分入队的**唯一边界**（启动重放 / ``/end`` / retry / 走人 / 结算共用）。

    执行位置由 ``SCORING_EXECUTION`` 决定（docs/ideas/pipeline-and-job-separation.md）：

    * ``inline``（默认）：入进程内 ``TaskQueue``，``app_state.task_queue`` 必填。``record_id``/
      ``case_data`` 在此被捕获为标量，闭包在 worker 阶段不回读 ORM 属性（走人路径的
      DetachedInstanceError 回归）；运行期依赖仍在 worker 阶段从 ``app_state`` 读取
      —— LLM 未就绪时是"任务入队后失败并等待清扫"，不是触发请求直接 500。
    * ``job``：只写一行 ``jobs``（记录已有挂起任务时是幂等 no-op）。输入不随行复制，
      认领者按 ``record_id`` 派生 —— 同一事实不做第二份拷贝（docs/17 §四）。

    Raises:
        RuntimeError: inline 模式下进程尚未 bootstrap 出 TaskQueue。
        QueueFullError: inline 模式下队列在入队超时内未腾出槽位 —— 不做任何补救，由调用方
            按自己的恢复策略处理（HTTP 回滚 503 / 走人交给结算清扫 / 结算重开记录 / 启动告警）。
    """
    if SCORING_EXECUTION == "job":
        await asyncio.to_thread(_enqueue_job_row, record_id, priority)
        return

    task_queue = getattr(app_state, "task_queue", None)
    if task_queue is None:
        raise RuntimeError("评分队列未就绪：TaskQueue 尚未启动")
    await task_queue.enqueue(
        lambda: run_scoring_background(
            record_id,
            case_data or {},
            llm_client=app_state.llm_client,
            tracker=getattr(app_state, "scoring_tracker", None),
            realtime_hub=getattr(app_state, "realtime_hub", None),
        ),
        priority=priority,
    )


def _enqueue_job_row(record_id: int, priority: int) -> int | None:
    """``SCORING_EXECUTION=job`` 的入队：写一行 jobs（同步，由调用方放进线程）。

    幂等：该记录已有挂起/执行中的评分任务时返回 None（``uq_jobs_active_scoring`` 去重）。
    这不是错误：记录自身的 ``scoring_status`` 才是执行期仲裁者，调用方要的结果
    （"这条记录的评分已被安排"）已经成立。
    """
    from infra import jobs

    with SessionLocal() as db:
        job_id = jobs.enqueue(db, kind=JOB_KIND_SCORING, record_id=record_id, priority=priority)
        db.commit()
    if job_id is None:
        log.info("评分任务已存在，跳过重复入队 record_id=%d", record_id)
    return job_id
