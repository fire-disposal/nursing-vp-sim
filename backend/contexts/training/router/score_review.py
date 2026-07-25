import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from contexts.training.scoring.validation import _recalc_total_from_dimensions
from core.database import get_db
from core.security import get_current_user, require_permission
from models import Score, ScoreReview, TrainingRecord, User
from schemas import ScoreReviewRequest, ScoreReviewResponse

log = logging.getLogger(__name__)

router = APIRouter()


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

    return ScoreReviewResponse(
        score_id=score.id,
        review_status="reviewed" if latest_review else "pending",
        reviewed_by_name=reviewer_name,
        reviewed_at=latest_review.created_at if latest_review else None,
        original_detail_scores=score.detail_scores,
        review_detail_scores=latest_review.detail_scores if latest_review else None,
        review_total_score=latest_review.total_score if latest_review else None,
        review_comment=latest_review.comment if latest_review else None,
    )


@router.post("/records/{record_id}/review", response_model=ScoreReviewResponse)
def submit_score_review(
    record_id: int,
    req: ScoreReviewRequest,
    current_user: Annotated[User, Depends(require_permission("score_review"))],
    db: Annotated[Session, Depends(get_db)],
):
    score = db.query(Score).filter(Score.record_id == record_id).first()
    if not score:
        raise HTTPException(status_code=404, detail="该记录暂无评分")

    if req.detail_scores is not None:
        raw_scale = 3
        review_total = _recalc_total_from_dimensions(req.detail_scores, raw_scale)
    else:
        review_total = None

    existing = db.query(ScoreReview).filter(ScoreReview.score_id == score.id).first()
    if existing:
        existing.detail_scores = req.detail_scores
        existing.comment = req.comment
        existing.total_score = review_total
        existing.reviewed_by = current_user.id
        db.commit()
        db.refresh(existing)
        review = existing
    else:
        review = ScoreReview(
            score_id=score.id,
            reviewed_by=current_user.id,
            detail_scores=req.detail_scores,
            comment=req.comment,
            total_score=review_total,
        )
        db.add(review)
        db.commit()
        db.refresh(review)

    log.info(
        f"评分复核: score_id={score.id} reviewer_id={current_user.id}",
        extra={"user_id": current_user.id, "user_role": current_user.role.name if current_user.role else ""},
    )

    return ScoreReviewResponse(
        score_id=score.id,
        review_status="reviewed",
        reviewed_by_name=current_user.display_name,
        reviewed_at=review.created_at,
        original_detail_scores=score.detail_scores,
        review_detail_scores=review.detail_scores,
        review_total_score=review.total_score,
        review_comment=review.comment,
    )
