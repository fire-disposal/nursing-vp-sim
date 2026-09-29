"""教师复核 —— 在**原始条目**上编辑，展示分与复核分来源分开保存。

本批次契约：

* 教师编辑的是原始刻度条目（0-``raw_scale``），不是取整后的展示项；不改条目直接提交时
  总分不变（Σ 原始条目 → 展示映射，与 AI 初评同一条公式）。
* AI 判据（``Score.detail_scores`` / ``Score.raw_detail_scores``）不被复核覆盖：教师条目
  另存 ``ScoreReview.detail_scores``，学生端两条来源都可见。
* 历史记录没有原始层（``score_meta`` 为空）时，复核基准由展示层反推，并在响应里标明基准
  来源（``review_basis``），不假装历史量尺已知。
"""

import logging
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from core.audit import (
    ACTION_SCORE_REVIEW_SUBMITTED,
    TARGET_TYPE_TRAINING_RECORD,
    record,
)
from core.database import get_db
from core.security import get_current_user, require_permission
from models import Score, ScoreReview, TrainingRecord, User
from modules.training.scoring.engine import DEFAULT_RAW_MAX, _resolve_rubric
from modules.training.scoring.validation import (
    raw_view_from_display,
    review_total_from_raw,
    sanitize_review_raw,
)
from schemas import ScoreReviewRequest, ScoreReviewResponse

log = logging.getLogger(__name__)

router = APIRouter()

BASIS_SCORE_META = "score_meta"
BASIS_LEGACY_DERIVED = "legacy_display_derived"


def _review_basis(score: Score, rubric: dict) -> tuple[float, str]:
    """复核分母与基准来源：新记录用评分时冻结的适用满分，历史记录按现行 rubric 反推。"""
    meta = score.score_meta or {}
    applicable = meta.get("applicable_raw_max")
    if isinstance(applicable, (int, float)) and applicable > 0:
        return float(applicable), BASIS_SCORE_META
    return float(rubric.get("raw_max", DEFAULT_RAW_MAX)), BASIS_LEGACY_DERIVED


def _raw_layer(score: Score, rubric: dict, applicable_raw_max: float) -> dict:
    """复核编辑用的原始条目层：新记录直接读原始快照，历史记录从展示层反推。"""
    if score.raw_detail_scores:
        return score.raw_detail_scores
    return raw_view_from_display(
        score.detail_scores or {},
        raw_max=int(applicable_raw_max) or DEFAULT_RAW_MAX,
        raw_scale=int(rubric.get("raw_scale", 2)),
    )


def _not_applicable_of(score: Score) -> frozenset[str]:
    meta = score.score_meta or {}
    items = meta.get("not_applicable_items")
    if not isinstance(items, list):
        return frozenset()
    return frozenset(str(item) for item in items)


@router.get("/records/{record_id}/review", response_model=ScoreReviewResponse)
def get_score_review(
    record_id: int,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    record = db.query(TrainingRecord).filter(TrainingRecord.id == record_id).first()
    if not record:
        raise HTTPException(status_code=404, detail="训练记录不存在")
    if record.user_id != current_user.id and not current_user.has_permission("score_review"):
        raise HTTPException(status_code=403, detail="无权查看该评分")

    score = db.query(Score).filter(Score.record_id == record_id).first()
    if not score:
        raise HTTPException(status_code=404, detail="该记录暂无评分")

    latest_review = (
        db.query(ScoreReview).filter(ScoreReview.score_id == score.id).order_by(ScoreReview.created_at.desc()).first()
    )
    reviewer_name = None
    if latest_review and latest_review.reviewed_by:
        reviewer = db.query(User).filter(User.id == latest_review.reviewed_by).first()
        reviewer_name = reviewer.display_name if reviewer else None

    rubric = _resolve_rubric(db, record)
    applicable_raw_max, basis = _review_basis(score, rubric)

    return ScoreReviewResponse(
        score_id=score.id,
        review_status="reviewed" if latest_review else "pending",
        reviewed_by_name=reviewer_name,
        reviewed_at=latest_review.created_at if latest_review else None,
        original_detail_scores=score.detail_scores,
        original_raw_detail_scores=_raw_layer(score, rubric, applicable_raw_max),
        review_detail_scores=latest_review.detail_scores if latest_review else None,
        review_total_score=latest_review.total_score if latest_review else None,
        review_comment=latest_review.comment if latest_review else None,
        applicable_raw_max=applicable_raw_max,
        raw_scale=int(rubric.get("raw_scale", 2)),
        review_basis=basis,
        not_applicable_items=sorted(_not_applicable_of(score)),
    )


@router.post("/records/{record_id}/review", response_model=ScoreReviewResponse)
def submit_score_review(
    record_id: int,
    req: ScoreReviewRequest,
    request: Request,
    current_user: Annotated[User, Depends(require_permission("score_review"))],
    db: Annotated[Session, Depends(get_db)],
):
    score = db.query(Score).filter(Score.record_id == record_id).first()
    if not score:
        raise HTTPException(status_code=404, detail="该记录暂无评分")

    training_record = db.query(TrainingRecord).filter(TrainingRecord.id == score.record_id).first()
    rubric: dict = {"raw_scale": 2, "raw_max": DEFAULT_RAW_MAX}
    if training_record is not None:
        rubric = _resolve_rubric(db, training_record)
    raw_scale = int(rubric.get("raw_scale", 2))
    applicable_raw_max, basis = _review_basis(score, rubric)
    not_applicable = _not_applicable_of(score)

    review_raw: dict | None = None
    review_total: int | None = None
    if req.detail_scores is not None:
        # 只接受该 rubric 的条目、钳制到原始量尺、不适用条目强制空值（sanitize_review_raw），
        # 因此复核总分恒 ≤ 100 且不可通过未知条目抬高。
        review_raw = sanitize_review_raw(req.detail_scores, rubric, not_applicable)
        review_total = review_total_from_raw(review_raw, applicable_raw_max, raw_scale)
        if not 0 <= review_total <= 100:
            raise HTTPException(status_code=400, detail=f"复核总分越界: {review_total}")

    # 变更前的成绩口径：审计的 before 值必须先于本次写入快照
    previous_reviewed_total = score.reviewed_total

    existing = db.query(ScoreReview).filter(ScoreReview.score_id == score.id).first()
    if existing:
        existing.detail_scores = review_raw
        existing.comment = req.comment
        existing.total_score = review_total
        existing.reviewed_by = current_user.id
        review = existing
        review_status = "updated"
    else:
        review = ScoreReview(
            score_id=score.id,
            reviewed_by=current_user.id,
            detail_scores=review_raw,
            comment=req.comment,
            total_score=review_total,
        )
        db.add(review)
        review_status = "created"

    if review_total is not None:
        score.reviewed_total = review_total
        score.reviewed_at = datetime.now(UTC)
        db.add(score)

    # 复核行、score 列、审计行共用**同一次** commit：请求成功即三者齐备，
    # 中途失败也不会留下"复核已提交但审计/成绩口径未跟上"的半状态。
    record(
        db,
        action=ACTION_SCORE_REVIEW_SUBMITTED,
        target_type=TARGET_TYPE_TRAINING_RECORD,
        target_id=score.record_id,
        request=request,
        payload={
            "score_id": score.id,
            "previous_reviewed_total": previous_reviewed_total,
            "reviewed_total": review_total,
            "review_status": review_status,
            # 复核基准与来源：历史记录按展示层反推时必须留痕，事后才能解释复核依据
            "review_basis": basis,
            "applicable_raw_max": applicable_raw_max,
            # 复核正文与评分明细可能含个人信息 → 只记体量，原文留在业务表里
            "detail_score_count": len(review_raw) if review_raw is not None else None,
            "comment_length": len(req.comment) if req.comment is not None else None,
        },
    )
    db.commit()
    db.refresh(review)

    log.info(
        f"评分复核: score_id={score.id} reviewer_id={current_user.id} basis={basis}",
        extra={"user_id": current_user.id, "user_role": current_user.role.name if current_user.role else ""},
    )

    return ScoreReviewResponse(
        score_id=score.id,
        review_status="reviewed",
        reviewed_by_name=current_user.display_name,
        reviewed_at=review.created_at,
        original_detail_scores=score.detail_scores,
        original_raw_detail_scores=_raw_layer(score, rubric, applicable_raw_max),
        review_detail_scores=review.detail_scores,
        review_total_score=review.total_score,
        review_comment=review.comment,
        applicable_raw_max=applicable_raw_max,
        raw_scale=raw_scale,
        review_basis=basis,
        not_applicable_items=sorted(not_applicable),
    )
