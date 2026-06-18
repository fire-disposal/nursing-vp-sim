import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from core.database import get_db
from core.security import get_current_user, require_permission
from models import Rubric, Score, ScoreReview, TrainingRecord, User
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
        record = db.query(TrainingRecord).filter(TrainingRecord.id == record_id).first()
        if record and record.rubric_frozen:
            try:
                name, ver = record.rubric_frozen.split("@", 1)
                rubric_ref = db.query(Rubric).filter(Rubric.name == name, Rubric.version == ver).first()
                if rubric_ref:
                    raw_scale = rubric_ref.raw_scale
            except (ValueError, AttributeError):
                pass
        new_total = 0.0
        for dim_data in req.detail_scores.values():
            if isinstance(dim_data, dict):
                raw_score = dim_data.get("score", 0)
                dim_max_100 = dim_data.get("max", 0)
                items = dim_data.get("items", [])
                if isinstance(items, list) and len(items) > 0 and dim_max_100 > 0:
                    raw_max_dim = len(items) * raw_scale
                    new_total += round(raw_score * dim_max_100 / raw_max_dim, 1)
                else:
                    new_total += raw_score
        score.total_score = round(new_total, 1)
    existing = db.query(ScoreReview).filter(ScoreReview.score_id == score.id).first()
    if existing:
        existing.detail_scores = req.detail_scores
        existing.comment = req.comment
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
        review_comment=review.comment,
    )
