import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from auth import create_access_token, get_current_user, hash_password, require_teacher, verify_password
from database import get_db
from models import Class, User, UserClass
from rate_limiter import login_rate_limit, register_rate_limit, reset_login_limit
from schemas import LoginRequest, RegisterRequest, TokenResponse, UserBrief

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/auth", tags=["认证"])


@router.post("/login", response_model=TokenResponse)
def login(
    req: LoginRequest,
    request: Request,
    db: Annotated[Session, Depends(get_db)],
    _: Annotated[None, Depends(login_rate_limit)],
):
    user = db.query(User).filter(User.username == req.username).first()
    if not user or not verify_password(req.password, user.password_hash):
        log.warning(f"登录失败: username={req.username}", extra={"action": "login_failed"})
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="用户名或密码错误")

    reset_login_limit(request)
    token = create_access_token({"user_id": user.id, "role": user.role})
    log.info(
        f"登录成功: username={req.username}", extra={"user_id": user.id, "user_role": user.role, "action": "login"}
    )
    return TokenResponse(
        access_token=token,
        role=user.role,
        display_name=user.display_name,
        user_id=user.id,
    )


@router.post("/register", response_model=TokenResponse)
def register(
    req: RegisterRequest,
    current_user: Annotated[User, Depends(require_teacher)],
    db: Annotated[Session, Depends(get_db)],
    _: Annotated[None, Depends(register_rate_limit)],
):
    existing = db.query(User).filter(User.username == req.username).first()
    if existing:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="用户名已存在")

    if req.role not in ("student", "teacher"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="角色必须为 student 或 teacher")

    if req.class_id is not None:
        cls = db.query(Class).filter(Class.id == req.class_id).first()
        if not cls:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="班级不存在")

    user = User(
        username=req.username,
        password_hash=hash_password(req.password),
        role=req.role,
        display_name=req.display_name,
        student_id=req.student_id,
    )
    db.add(user)
    db.flush()

    if req.class_id is not None:
        db.add(UserClass(user_id=user.id, class_id=req.class_id))

    db.commit()
    db.refresh(user)
    log.info(
        f"用户注册: target_id={user.id} target_name={user.username} role={user.role}",
        extra={"user_id": current_user.id, "user_role": current_user.role, "action": "register"},
    )
    return TokenResponse(
        access_token=create_access_token({"user_id": user.id, "role": user.role}),
        role=user.role,
        display_name=user.display_name,
        user_id=user.id,
    )


@router.get("/me", response_model=UserBrief)
def get_me(current_user: Annotated[User, Depends(get_current_user)]):
    return current_user
