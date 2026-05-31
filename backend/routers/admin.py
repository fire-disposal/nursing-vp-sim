from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import func, Integer as SAInteger
from database import get_db
from models import User, TrainingRecord, Score, LLMCallLog, Case as CaseModel
from schemas import UserBrief, AdminStats, UserUpdateRequest, BatchUserItem, BatchCreateResult, LLMStatsResponse, LLMCallLogItem, PaginatedResponse
from auth import require_teacher, hash_password
from logger import log_info
import os
import shutil
from datetime import datetime, timezone
from datetime import timedelta
from config import DATABASE_URL
from fastapi.responses import FileResponse
import tempfile
import zipfile
import subprocess
import threading
from urllib.parse import urlparse

router = APIRouter(prefix="/api/admin", tags=["管理"])


@router.get("/users", response_model=PaginatedResponse[UserBrief])
def list_users(
    offset: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=100),
    current_user: User = Depends(require_teacher),
    db: Session = Depends(get_db),
):
    total = db.query(User).count()
    users = db.query(User).order_by(User.created_at.desc()).offset(offset).limit(limit).all()
    return PaginatedResponse(items=users, total=total, offset=offset, limit=limit)


@router.put("/users/{user_id}", response_model=UserBrief)
def update_user(
    user_id: int,
    req: UserUpdateRequest,
    current_user: User = Depends(require_teacher),
    db: Session = Depends(get_db),
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")

    if req.display_name is not None:
        user.display_name = req.display_name
    if req.student_id is not None:
        user.student_id = req.student_id if req.student_id else None
    if req.role is not None:
        if req.role not in ("student", "teacher"):
            raise HTTPException(status_code=400, detail="角色必须为 student 或 teacher")
        user.role = req.role
    if req.password is not None and req.password:
        if len(req.password) < 6:
            raise HTTPException(status_code=400, detail="密码长度不能少于6位")
        user.password_hash = hash_password(req.password)

    db.commit()
    db.refresh(user)
    log_info(f"用户更新: target_id={user_id} target_name={user.username}",
             user_id=current_user.id, user_role=current_user.role)
    return user


@router.delete("/users/{user_id}")
def delete_user(
    user_id: int,
    current_user: User = Depends(require_teacher),
    db: Session = Depends(get_db),
):
    if user_id == current_user.id:
        raise HTTPException(status_code=400, detail="不能删除自己")

    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")

    record_count = db.query(func.count(TrainingRecord.id)).filter(
        TrainingRecord.user_id == user_id
    ).scalar() or 0
    if record_count > 0:
        raise HTTPException(
            status_code=400,
            detail=f"该用户有 {record_count} 条训练记录，无法删除。请先删除相关训练记录。",
        )

    target_name = user.username
    db.delete(user)
    db.commit()
    log_info(f"用户删除: target_id={user_id} target_name={target_name}",
             user_id=current_user.id, user_role=current_user.role)
    return {"message": "用户已删除"}


@router.post("/users/batch", response_model=BatchCreateResult)
def batch_create_users(
    users: list[BatchUserItem],
    current_user: User = Depends(require_teacher),
    db: Session = Depends(get_db),
):
    created = 0
    skipped = 0
    errors = []
    for u in users:
        if not u.username.strip() or not u.password or not u.display_name.strip():
            errors.append(f"跳过: 用户名/密码/姓名不能为空")
            skipped += 1
            continue
        if len(u.password) < 6:
            errors.append(f"跳过 {u.username}: 密码长度不能少于6位")
            skipped += 1
            continue
        if u.role not in ("student", "teacher"):
            errors.append(f"跳过 {u.username}: 角色无效")
            skipped += 1
            continue
        existing = db.query(User).filter(User.username == u.username).first()
        if existing:
            errors.append(f"跳过 {u.username}: 用户名已存在")
            skipped += 1
            continue
        db.add(User(
            username=u.username,
            password_hash=hash_password(u.password),
            display_name=u.display_name,
            role=u.role,
            student_id=u.student_id if u.student_id else None,
        ))
        created += 1
    db.commit()
    log_info(f"批量导入: created={created} skipped={skipped}",
             user_id=current_user.id, user_role=current_user.role)
    return {"created": created, "skipped": skipped, "errors": errors}


@router.get("/stats", response_model=AdminStats)
def get_stats(current_user: User = Depends(require_teacher), db: Session = Depends(get_db)):
    total_students = db.query(User).filter(User.role == "student").count()
    total_records = db.query(TrainingRecord).count()
    completed_records = db.query(TrainingRecord).filter(TrainingRecord.status == "completed").count()
    avg_score = db.query(func.avg(Score.total_score)).scalar()

    avg_duration = db.query(func.avg(
        func.extract('epoch', TrainingRecord.end_time - TrainingRecord.start_time) / 60
    )).filter(
        TrainingRecord.status == "completed",
        TrainingRecord.end_time.isnot(None),
        TrainingRecord.start_time.isnot(None),
    ).scalar()

    today_start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    today_records = db.query(func.count(TrainingRecord.id)).filter(
        TrainingRecord.start_time >= today_start
    ).scalar() or 0

    return AdminStats(
        total_students=total_students,
        total_records=total_records,
        completed_records=completed_records,
        average_score=round(float(avg_score), 1) if avg_score else None,
        avg_duration_min=round(float(avg_duration), 1) if avg_duration else None,
        today_records=today_records,
    )


@router.post("/backup")
def backup_database(current_user: User = Depends(require_teacher)):
    """创建数据库备份，返回 zip 文件下载。教师权限。"""
    parsed = urlparse(DATABASE_URL)
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    tmpdir = tempfile.mkdtemp()

    try:
        env = os.environ.copy()
        if parsed.password:
            env["PGPASSWORD"] = parsed.password

        cmd = [
            "pg_dump",
            "-h", parsed.hostname or "localhost",
            "-p", str(parsed.port or 5432),
            "-U", parsed.username or "postgres",
            "-d", parsed.path.lstrip("/"),
            "-f", os.path.join(tmpdir, f"dump_{timestamp}.sql"),
            "--no-owner",
            "--no-acl",
        ]

        result = subprocess.run(cmd, env=env, capture_output=True, text=True)
        if result.returncode != 0:
            raise HTTPException(status_code=500, detail=f"pg_dump 失败: {result.stderr}")

        dump_path = os.path.join(tmpdir, f"dump_{timestamp}.sql")

        zip_path = os.path.join(tmpdir, f"backup_{timestamp}.zip")
        with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
            zf.write(dump_path, arcname=os.path.basename(dump_path))

        log_info(f"数据库备份: backup_{timestamp}.zip",
                 user_id=current_user.id, user_role=current_user.role)

        def cleanup():
            import time
            time.sleep(5)
            shutil.rmtree(tmpdir, ignore_errors=True)
        threading.Thread(target=cleanup, daemon=True).start()

        return FileResponse(
            zip_path,
            media_type="application/zip",
            filename=f"nursing_backup_{timestamp}.zip",
        )

    except HTTPException:
        shutil.rmtree(tmpdir, ignore_errors=True)
        raise



# ── LLM 调用监控 ──

def _build_llm_stats(db: Session, since: datetime):
    """查询指定时间范围内的 LLM 调用统计数据"""
    base = db.query(LLMCallLog).filter(LLMCallLog.created_at >= since, LLMCallLog.created_at < datetime.now(timezone.utc))
    total = base.count()
    if total == 0:
        return {"count": 0, "success_rate": 0, "avg_latency_ms": 0, "total_cost": 0}
    success_count = base.filter(LLMCallLog.status == "success").count()
    avg_latency = db.query(func.avg(LLMCallLog.latency_ms)).filter(
        LLMCallLog.created_at >= since, LLMCallLog.created_at < datetime.now(timezone.utc)
    ).scalar() or 0
    total_cost = db.query(func.sum(LLMCallLog.estimated_cost)).filter(
        LLMCallLog.created_at >= since, LLMCallLog.created_at < datetime.now(timezone.utc)
    ).scalar() or 0
    return {
        "count": total,
        "success_rate": round(success_count / total * 100, 1),
        "avg_latency_ms": round(avg_latency, 0),
        "total_cost": round(total_cost, 4),
    }


@router.get("/llm-stats", response_model=LLMStatsResponse)
def get_llm_stats(current_user: User = Depends(require_teacher), db: Session = Depends(get_db)):
    now = datetime.now(timezone.utc)
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    week_start = today_start - timedelta(days=7)
    month_start = today_start - timedelta(days=30)

    today_stats = _build_llm_stats(db, today_start)
    week_stats = _build_llm_stats(db, week_start)

    # by_purpose
    rows = db.query(
        LLMCallLog.purpose,
        func.count().label("count"),
        func.avg(LLMCallLog.latency_ms).label("avg_latency"),
        func.sum(func.cast(LLMCallLog.status != "success", type_=SAInteger)).label("error_count"),
    ).filter(LLMCallLog.created_at >= week_start, LLMCallLog.created_at < now).group_by(LLMCallLog.purpose).all()
    by_purpose = [
        {"purpose": r[0], "count": r[1], "avg_latency_ms": round(r[2] or 0, 0), "error_count": r[3]}
        for r in rows
    ]

    # daily: 最近30天
    daily_rows = db.query(
        func.date(LLMCallLog.created_at).label("date"),
        func.count().label("count"),
        func.sum(func.cast(LLMCallLog.status == "success", type_=SAInteger)).label("success_count"),
        func.sum(func.cast(LLMCallLog.status != "success", type_=SAInteger)).label("fail_count"),
        func.sum(LLMCallLog.estimated_cost).label("total_cost"),
    ).filter(LLMCallLog.created_at >= month_start, LLMCallLog.created_at < now).group_by("date").order_by("date").all()
    daily = [
        {"date": str(r[0]), "count": r[1], "success_count": r[2] or 0, "fail_count": r[3] or 0, "total_cost": round(r[4] or 0, 4)}
        for r in daily_rows
    ]

    return LLMStatsResponse(
        today=today_stats,
        week=week_stats,
        by_purpose=by_purpose,
        daily=daily,
    )


@router.get("/llm-logs", response_model=PaginatedResponse[LLMCallLogItem])
def get_llm_logs(
    offset: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=100),
    purpose: str | None = None,
    status: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    aggregate_patient_chat: bool = True,
    current_user: User = Depends(require_teacher),
    db: Session = Depends(get_db),
):
    """返回 LLM 调用日志。aggregate_patient_chat=true 时将同一训练下的 patient_chat 聚合为一条训练级记录。"""
    do_agg = aggregate_patient_chat and (purpose is None or purpose == "patient_chat")
    need_raw = (not aggregate_patient_chat) or (purpose != "patient_chat")

    agg_count = 0
    raw_count = 0
    agg_rows = []
    raw_rows = []

    if do_agg:
        agg_q = db.query(
            LLMCallLog.record_id.label("record_id"),
            func.max(LLMCallLog.id).label("id"),
            func.max(LLMCallLog.user_id).label("user_id"),
            func.max(LLMCallLog.case_id).label("case_id"),
            func.count().label("call_count"),
            func.avg(LLMCallLog.latency_ms).label("latency_ms"),
            func.sum(LLMCallLog.prompt_tokens).label("prompt_tokens"),
            func.sum(LLMCallLog.completion_tokens).label("completion_tokens"),
            func.sum(LLMCallLog.total_tokens).label("total_tokens"),
            func.max(LLMCallLog.token_estimated).label("token_estimated"),
            func.sum(LLMCallLog.estimated_cost).label("estimated_cost"),
            func.sum(func.cast(LLMCallLog.status != "success", type_=SAInteger)).label("error_count"),
            func.min(LLMCallLog.created_at).label("first_called_at"),
            func.max(LLMCallLog.created_at).label("created_at"),
            User.display_name.label("student_name"),
            CaseModel.name.label("case_name"),
        ).join(TrainingRecord, LLMCallLog.record_id == TrainingRecord.id, isouter=True) \
         .join(User, TrainingRecord.user_id == User.id, isouter=True) \
         .join(CaseModel, TrainingRecord.case_id == CaseModel.id, isouter=True) \
         .filter(
            LLMCallLog.purpose == "patient_chat",
            LLMCallLog.record_id.isnot(None),
        )

        if date_from:
            agg_q = agg_q.filter(LLMCallLog.created_at >= datetime.fromisoformat(date_from))
        if date_to:
            agg_q = agg_q.filter(LLMCallLog.created_at < datetime.fromisoformat(date_to))

        agg_q = agg_q.group_by(LLMCallLog.record_id)

        if status == "success":
            agg_q = agg_q.having(func.sum(func.cast(LLMCallLog.status != "success", type_=SAInteger)) == 0)
        elif status == "failed":
            agg_q = agg_q.having(func.sum(func.cast(LLMCallLog.status != "success", type_=SAInteger)) > 0)

        agg_count = agg_q.order_by(None).count()
        agg_rows = agg_q.order_by(func.max(LLMCallLog.created_at).desc()).offset(offset).limit(limit).all()

    if need_raw:
        q = db.query(LLMCallLog)
        if aggregate_patient_chat and purpose is None:
            q = q.filter(LLMCallLog.purpose != "patient_chat")
        elif purpose:
            q = q.filter(LLMCallLog.purpose == purpose)
        if status:
            q = q.filter(LLMCallLog.status == status)
        if date_from:
            q = q.filter(LLMCallLog.created_at >= datetime.fromisoformat(date_from))
        if date_to:
            q = q.filter(LLMCallLog.created_at < datetime.fromisoformat(date_to))

        raw_count = q.order_by(None).count()

        remaining_offset = max(0, offset - agg_count)
        remaining_limit = max(0, limit - len(agg_rows))
        if remaining_limit > 0:
            raw_rows = q.order_by(LLMCallLog.created_at.desc()).offset(remaining_offset).limit(remaining_limit).all()

    total = agg_count + raw_count

    all_items = []

    for r in agg_rows:
        avg_lat = round(r.latency_ms) if r.latency_ms is not None else None
        all_items.append({
            "id": r.id,
            "user_id": r.user_id,
            "record_id": r.record_id,
            "case_id": r.case_id,
            "purpose": "patient_chat",
            "provider": "deepseek",
            "model": "",
            "temperature": None,
            "max_tokens": None,
            "prompt_tokens": r.prompt_tokens,
            "completion_tokens": r.completion_tokens,
            "total_tokens": r.total_tokens,
            "token_estimated": 1 if r.token_estimated else 0,
            "estimated_cost": round(r.estimated_cost, 6) if r.estimated_cost is not None else None,
            "cost_currency": None,
            "latency_ms": avg_lat,
            "status": "success" if (r.error_count or 0) == 0 else "failed",
            "error_type": None,
            "error_message": None,
            "request_chars": None,
            "response_chars": None,
            "created_at": r.created_at,
            "call_count": r.call_count,
            "avg_latency_ms": avg_lat,
            "error_count": r.error_count or 0,
            "first_called_at": r.first_called_at,
            "last_called_at": r.created_at,
            "student_name": r.student_name,
            "case_name": r.case_name,
            "is_aggregated": True,
        })

    all_items.extend(raw_rows)

    def _get_ts(item):
        if isinstance(item, dict):
            return item["created_at"]
        return item.created_at

    all_items.sort(key=_get_ts, reverse=True)

    items = []
    for it in all_items:
        if isinstance(it, dict):
            items.append(LLMCallLogItem(**it))
        else:
            items.append(LLMCallLogItem.model_validate(it))

    return PaginatedResponse(items=items, total=total, offset=offset, limit=limit)
