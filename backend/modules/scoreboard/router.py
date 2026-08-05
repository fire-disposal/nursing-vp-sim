"""成绩管理 — 学生平均成绩排名 / 分层 / 进步幅度 查询端点。"""

import logging
from typing import Annotated

from fastapi import APIRouter, Depends, Query

from core.deps import DbSession
from core.security import require_permission
from models import User
from modules.scoreboard.service import ScoreboardScope, ScoreboardService
from schemas.scoreboard import ScoreboardRankingResponse, StudentTrendResponse

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/scoreboard", tags=["成绩管理"])

_ScoreboardUser = Annotated[User, Depends(require_permission("assignment_manage"))]


@router.get("/ranking", response_model=ScoreboardRankingResponse)
def scoreboard_ranking(
    current_user: _ScoreboardUser,
    db: DbSession,
    case_id: Annotated[int | None, Query(description="病例范围，缺省=全部病例")] = None,
    class_id: Annotated[int | None, Query(description="班级筛选")] = None,
    assignment_id: Annotated[str | None, Query(description="指定作业")] = None,
    assignment_status: Annotated[str | None, Query(description="作业状态限定：active|ended")] = None,
    include_free: Annotated[bool, Query(description="是否纳入自主训练（无作业关联）记录")] = False,
    search: Annotated[str | None, Query(max_length=50, description="学生姓名/学号模糊检索")] = None,
    sort_by: Annotated[
        str, Query(description="排序：avg_score|best_score|avg_duration|training_count|progress")
    ] = "avg_score",
    order: Annotated[str, Query(description="排序方向：desc|asc")] = "desc",
    tier: Annotated[str | None, Query(description="分层过滤：good|medium|poor")] = None,
    offset: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
):
    return ScoreboardService(db).ranking(
        scope=ScoreboardScope(
            case_id=case_id,
            class_id=class_id,
            assignment_id=assignment_id,
            assignment_status=assignment_status,
            include_free=include_free,
        ),
        search=search,
        sort_by=sort_by,
        order=order,
        tier=tier,
        offset=offset,
        limit=limit,
    )


@router.get("/students/{user_id}/trend", response_model=StudentTrendResponse)
def student_trend(
    user_id: int,
    current_user: _ScoreboardUser,
    db: DbSession,
    case_id: Annotated[int | None, Query(description="病例范围，缺省=全部病例")] = None,
    class_id: Annotated[int | None, Query(description="班级筛选")] = None,
    assignment_id: Annotated[str | None, Query(description="指定作业")] = None,
    assignment_status: Annotated[str | None, Query(description="作业状态限定：active|ended")] = None,
    include_free: Annotated[bool, Query(description="是否纳入自主训练（无作业关联）记录")] = False,
):
    return ScoreboardService(db).student_trend(
        user_id,
        scope=ScoreboardScope(
            case_id=case_id,
            class_id=class_id,
            assignment_id=assignment_id,
            assignment_status=assignment_status,
            include_free=include_free,
        ),
    )
