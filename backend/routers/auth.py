from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session
from database import get_db
from models import User
from schemas import LoginRequest, RegisterRequest, TokenResponse
from auth import hash_password, verify_password, create_access_token, get_current_user, require_teacher
from rate_limiter import login_rate_limit, register_rate_limit, reset_login_limit
from logger import log_info, log_warning

router = APIRouter(prefix="/api/auth", tags=["认证"])


@router.post("/login", response_model=TokenResponse)
def login(
    req: LoginRequest,
    request: Request,
    db: Session = Depends(get_db),
    _: None = Depends(login_rate_limit),
):
    user = db.query(User).filter(User.username == req.username).first()
    if not user or not verify_password(req.password, user.password_hash):
        log_warning(f"登录失败: username={req.username}", action="login_failed")
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="用户名或密码错误")

    reset_login_limit(request)
    token = create_access_token({"user_id": user.id, "role": user.role})
    log_info(f"登录成功: username={req.username}", user_id=user.id, user_role=user.role, action="login")
    return TokenResponse(
        access_token=token,
        role=user.role,
        display_name=user.display_name,
        user_id=user.id,
    )


@router.post("/register", response_model=TokenResponse)
def register(
    req: RegisterRequest,
    current_user: User = Depends(require_teacher),
    db: Session = Depends(get_db),
    _: None = Depends(register_rate_limit),
):
    existing = db.query(User).filter(User.username == req.username).first()
    if existing:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="用户名已存在")

    if req.role not in ("student", "teacher"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="角色必须为 student 或 teacher")

    user = User(
        username=req.username,
        password_hash=hash_password(req.password),
        role=req.role,
        display_name=req.display_name,
        student_id=req.student_id,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    log_info(f"用户注册: target_id={user.id} target_name={user.username} role={user.role}",
             user_id=current_user.id, user_role=current_user.role, action="register")
    return TokenResponse(
        access_token=create_access_token({"user_id": user.id, "role": user.role}),
        role=user.role,
        display_name=user.display_name,
        user_id=user.id,
    )


@router.get("/me")
def get_me(current_user: User = Depends(get_current_user)):
    return {
        "id": current_user.id,
        "username": current_user.username,
        "role": current_user.role,
        "display_name": current_user.display_name,
        "student_id": current_user.student_id,
    }
