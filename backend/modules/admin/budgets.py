"""成本限额管理：院校月额度（平台设定）与用户日额度（平台/院校管理员设定）。"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy import or_

from core.budget import effective_user_limit, school_monthly_spend, user_daily_spend
from core.deps import DbSession
from core.exceptions import NotFoundError, ValidationError
from core.personas import is_super_admin
from core.security import get_current_user, require_permission
from core.tenant import Scope, TenantScope, scope_query
from infra.ops_queries import cn_day_start, cn_month_start
from models import School, SchoolBudget, User, UserBudget
from schemas.voice.cost import (
    BudgetUpdateRequest,
    MyQuotaBucket,
    MyQuotaResponse,
    SchoolBudgetItem,
    SchoolBudgetUpdateRequest,
    UserBudgetItem,
)

router = APIRouter(prefix="/costs/budgets", tags=["成本限额"])

_CurrentUser = Annotated[User, Depends(get_current_user)]

_SchoolManager = Annotated[User, Depends(require_permission("school_manage"))]
_UserManager = Annotated[User, Depends(require_permission("user_manage"))]


def _school_ids_in_scope(db, scope: TenantScope) -> list[School]:
    q = db.query(School)
    if scope.school_id is not None:
        q = q.filter(School.id == scope.school_id)
    return q.order_by(School.id).all()


@router.get("/me", response_model=MyQuotaResponse)
def my_quota(current_user: _CurrentUser, db: DbSession) -> MyQuotaResponse:
    """当前用户的可用额度：个人日额度 + 院校月额度与重置时间。"""
    now = datetime.now(UTC)
    day_reset = cn_day_start(now) + timedelta(days=1)
    month_start = cn_month_start(now)
    month_reset = (
        month_start.replace(year=month_start.year + 1, month=1)
        if month_start.month == 12
        else month_start.replace(month=month_start.month + 1)
    )
    llm_limit, llm_source = effective_user_limit(db, current_user, "llm")
    tts_limit, tts_source = effective_user_limit(db, current_user, "tts")
    school_budget = (
        db.query(SchoolBudget).filter(SchoolBudget.school_id == current_user.school_id).first()
        if current_user.school_id is not None
        else None
    )
    return MyQuotaResponse(
        llm=MyQuotaBucket(limit=llm_limit, used=user_daily_spend(db, current_user.id, "llm"), source=llm_source),
        tts=MyQuotaBucket(limit=tts_limit, used=user_daily_spend(db, current_user.id, "tts"), source=tts_source),
        school_name=(
            db.query(School.name).filter(School.id == current_user.school_id).scalar()
            if current_user.school_id is not None
            else None
        ),
        school_llm_limit=school_budget.llm_monthly_limit if school_budget else 0.0,
        school_tts_limit=school_budget.tts_monthly_limit if school_budget else 0.0,
        school_llm_used=(
            school_monthly_spend(db, current_user.school_id, "llm") if current_user.school_id is not None else 0.0
        ),
        school_tts_used=(
            school_monthly_spend(db, current_user.school_id, "tts") if current_user.school_id is not None else 0.0
        ),
        day_reset_at=day_reset.isoformat(),
        month_reset_at=month_reset.isoformat(),
    )


@router.get("/schools", response_model=list[SchoolBudgetItem])
def list_school_budgets(current_user: _SchoolManager, db: DbSession, scope: Scope) -> list[SchoolBudgetItem]:
    schools = _school_ids_in_scope(db, scope)
    budgets = {
        row.school_id: row for row in db.query(SchoolBudget).filter(SchoolBudget.school_id.in_([s.id for s in schools]))
    }
    return [
        SchoolBudgetItem(
            school_id=school.id,
            school_name=school.name,
            llm_monthly_limit=(budgets[school.id].llm_monthly_limit if school.id in budgets else 0.0),
            tts_monthly_limit=(budgets[school.id].tts_monthly_limit if school.id in budgets else 0.0),
            default_daily_llm_limit=(budgets[school.id].default_daily_llm_limit if school.id in budgets else None),
            default_daily_tts_limit=(budgets[school.id].default_daily_tts_limit if school.id in budgets else None),
            llm_used=school_monthly_spend(db, school.id, "llm"),
            tts_used=school_monthly_spend(db, school.id, "tts"),
        )
        for school in schools
    ]


@router.put("/schools/{school_id}", response_model=SchoolBudgetItem)
def set_school_budget(
    school_id: int,
    req: SchoolBudgetUpdateRequest,
    current_user: _SchoolManager,
    db: DbSession,
    scope: Scope,
) -> SchoolBudgetItem:
    school = db.query(School).filter(School.id == school_id).first()
    if school is None or (scope.school_id is not None and school.id != scope.school_id):
        raise NotFoundError("院校不存在")
    row = db.query(SchoolBudget).filter(SchoolBudget.school_id == school_id).first()
    if row is None:
        row = SchoolBudget(school_id=school_id)
        db.add(row)
    row.llm_monthly_limit = max(0.0, req.llm_monthly_limit)
    row.tts_monthly_limit = max(0.0, req.tts_monthly_limit)
    row.default_daily_llm_limit = req.default_daily_llm_limit
    row.default_daily_tts_limit = req.default_daily_tts_limit
    row.updated_by = current_user.id
    db.commit()
    return SchoolBudgetItem(
        school_id=school.id,
        school_name=school.name,
        llm_monthly_limit=row.llm_monthly_limit,
        tts_monthly_limit=row.tts_monthly_limit,
        default_daily_llm_limit=row.default_daily_llm_limit,
        default_daily_tts_limit=row.default_daily_tts_limit,
        llm_used=school_monthly_spend(db, school.id, "llm"),
        tts_used=school_monthly_spend(db, school.id, "tts"),
    )


@router.get("/users", response_model=list[UserBudgetItem])
def list_user_budgets(
    current_user: _UserManager,
    db: DbSession,
    scope: Scope,
    school_id: Annotated[int | None, Query()] = None,
    search: Annotated[str | None, Query()] = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
) -> list[UserBudgetItem]:
    q = scope_query(db.query(User), User.school_id, scope)
    if school_id is not None:
        q = q.filter(User.school_id == school_id)
    if search:
        term = f"%{search}%"
        q = q.filter(or_(User.username.ilike(term), User.display_name.ilike(term)))
    users = q.order_by(User.id).limit(limit).all()
    rows = {row.user_id: row for row in db.query(UserBudget).filter(UserBudget.user_id.in_([u.id for u in users]))}
    school_ids = {u.school_id for u in users if u.school_id is not None}
    schools = {s.id: s for s in db.query(School).filter(School.id.in_(school_ids))} if school_ids else {}
    school_budgets = (
        {b.school_id: b for b in db.query(SchoolBudget).filter(SchoolBudget.school_id.in_(school_ids))}
        if school_ids
        else {}
    )
    school_spend = {
        sid: (school_monthly_spend(db, sid, "llm"), school_monthly_spend(db, sid, "tts")) for sid in school_ids
    }
    out = []
    for user in users:
        row = rows.get(user.id)
        llm_limit, llm_source = effective_user_limit(db, user, "llm")
        tts_limit, _ = effective_user_limit(db, user, "tts")
        out.append(
            UserBudgetItem(
                user_id=user.id,
                username=user.username,
                display_name=user.display_name,
                school_id=user.school_id,
                daily_llm_limit=llm_limit,
                daily_tts_limit=tts_limit,
                is_default=row is None,
                source=llm_source,
                llm_used_today=user_daily_spend(db, user.id, "llm"),
                tts_used_today=user_daily_spend(db, user.id, "tts"),
                school_name=schools[user.school_id].name if user.school_id in schools else None,
                school_llm_limit=(
                    school_budgets[user.school_id].llm_monthly_limit if user.school_id in school_budgets else 0.0
                ),
                school_tts_limit=(
                    school_budgets[user.school_id].tts_monthly_limit if user.school_id in school_budgets else 0.0
                ),
                school_llm_used=(school_spend[user.school_id][0] if user.school_id in school_spend else 0.0),
                school_tts_used=(school_spend[user.school_id][1] if user.school_id in school_spend else 0.0),
            )
        )
    return out


@router.put("/users/{user_id}", response_model=UserBudgetItem)
def set_user_budget(
    user_id: int,
    req: BudgetUpdateRequest,
    current_user: _UserManager,
    db: DbSession,
    scope: Scope,
) -> UserBudgetItem:
    user = scope_query(db.query(User), User.school_id, scope).filter(User.id == user_id).first()
    if user is None:
        raise NotFoundError("用户不存在")
    if is_super_admin(user):
        raise ValidationError("平台账号不适用个人额度")
    row = db.query(UserBudget).filter(UserBudget.user_id == user_id).first()
    if row is None:
        row = UserBudget(user_id=user_id)
        db.add(row)
    row.daily_llm_limit = max(0.0, req.llm_limit)
    row.daily_tts_limit = max(0.0, req.tts_limit)
    row.updated_by = current_user.id
    db.commit()
    return UserBudgetItem(
        user_id=user.id,
        username=user.username,
        display_name=user.display_name,
        school_id=user.school_id,
        daily_llm_limit=row.daily_llm_limit,
        daily_tts_limit=row.daily_tts_limit,
        is_default=False,
        llm_used_today=user_daily_spend(db, user.id, "llm"),
        tts_used_today=user_daily_spend(db, user.id, "tts"),
        school_name=(db.query(School.name).filter(School.id == user.school_id).scalar() if user.school_id else None),
        school_llm_limit=(
            db.query(SchoolBudget.llm_monthly_limit).filter(SchoolBudget.school_id == user.school_id).scalar() or 0.0
        )
        if user.school_id
        else 0.0,
        school_tts_limit=(
            db.query(SchoolBudget.tts_monthly_limit).filter(SchoolBudget.school_id == user.school_id).scalar() or 0.0
        )
        if user.school_id
        else 0.0,
        school_llm_used=(school_monthly_spend(db, user.school_id, "llm") if user.school_id else 0.0),
        school_tts_used=(school_monthly_spend(db, user.school_id, "tts") if user.school_id else 0.0),
    )


@router.delete("/schools/{school_id}")
def clear_school_budget(school_id: int, current_user: _SchoolManager, db: DbSession, scope: Scope) -> dict[str, bool]:
    """清除院校额度设置：月度重新不限，用户默认日额度回到平台默认。"""
    school = db.query(School).filter(School.id == school_id).first()
    if school is None or (scope.school_id is not None and school.id != scope.school_id):
        raise NotFoundError("院校不存在")
    db.query(SchoolBudget).filter(SchoolBudget.school_id == school_id).delete()
    db.commit()
    return {"ok": True}


@router.delete("/users/{user_id}")
def clear_user_budget(user_id: int, current_user: _UserManager, db: DbSession, scope: Scope) -> dict[str, bool]:
    """清除用户个人额度：回到院校默认 → 平台默认。"""
    user = scope_query(db.query(User), User.school_id, scope).filter(User.id == user_id).first()
    if user is None:
        raise NotFoundError("用户不存在")
    db.query(UserBudget).filter(UserBudget.user_id == user_id).delete()
    db.commit()
    return {"ok": True}
