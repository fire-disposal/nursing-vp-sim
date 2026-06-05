import asyncio
import logging
import secrets
import string
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from core.database import get_db
from core.security import create_access_token, get_current_user, hash_password, require_permission, verify_password
from middleware.rate_limits import login_rate_limit, register_rate_limit, reset_login_limit
from models import Class, Role, RolePermission, School, User, UserClass
from schemas import (
    LoginRequest,
    OkResponse,
    RegisterRequest,
    TokenResponse,
    UserBrief,
    WechatBindRequest,
    WechatLoginRequest,
    WechatLoginResponse,
    WechatRegisterRequest,
)

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/auth", tags=["认证"])


@router.post("/login", response_model=TokenResponse)
async def login(
    req: LoginRequest,
    request: Request,
    db: Annotated[Session, Depends(get_db)],
    _: Annotated[None, Depends(login_rate_limit)],
):
    user = db.query(User).filter(User.username == req.username).first()
    if not user or not await asyncio.to_thread(verify_password, req.password, user.password_hash):
        log.warning(f"登录失败: username={req.username}", extra={"action": "login_failed"})
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="用户名或密码错误")

    await reset_login_limit(request)
    token = create_access_token({"user_id": user.id, "role_id": user.role_id, "school_id": user.school_id, "role": user.role.name if user.role else ""})
    log.info(
        f"登录成功: username={req.username}", extra={"user_id": user.id, "user_role": user.role.name if user.role else "", "action": "login"}
    )
    rows = db.query(RolePermission.permission).filter(RolePermission.role_id == user.role_id).all()
    permissions = [r.permission for r in rows]
    return TokenResponse(
        access_token=token,
        role=user.role.name if user.role else "",
        display_name=user.display_name,
        user_id=user.id,
        school_id=user.school_id,
        school_name=user.school.name if user.school else None,
        permissions=permissions,
    )


@router.post("/register", response_model=TokenResponse)
def register(
    req: RegisterRequest,
    current_user: Annotated[User, Depends(require_permission("user_manage"))],
    db: Annotated[Session, Depends(get_db)],
    _: Annotated[None, Depends(register_rate_limit)],
):
    existing = db.query(User).filter(User.username == req.username).first()
    if existing:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="用户名已存在")

    if req.role not in ("student", "teacher"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="角色必须为 student 或 teacher")

    role_obj = db.query(Role).filter(Role.name == req.role, Role.school_id == current_user.school_id).first()
    if not role_obj:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="角色不存在")

    if req.class_id is not None:
        cls = db.query(Class).filter(Class.id == req.class_id).first()
        if not cls:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="班级不存在")

    user = User(
        username=req.username,
        password_hash=hash_password(req.password),
        role_id=role_obj.id,
        school_id=current_user.school_id,
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
        f"用户注册: target_id={user.id} target_name={user.username} role={user.role.name if user.role else ''}",
        extra={"user_id": current_user.id, "user_role": current_user.role.name if current_user.role else "", "action": "register"},
    )
    return TokenResponse(
        access_token=create_access_token({"user_id": user.id, "role_id": user.role_id, "school_id": user.school_id, "role": user.role.name if user.role else ""}),
        role=user.role.name if user.role else "",
        display_name=user.display_name,
        user_id=user.id,
        school_id=user.school_id,
        school_name=user.school.name if user.school else None,
    )


@router.post("/wechat/login", response_model=WechatLoginResponse)
async def wechat_login(
    req: WechatLoginRequest,
    db: Annotated[Session, Depends(get_db)],
):
    """微信小程序 code 登录。已知 openid → 签发 JWT；未知 → need_bind"""
    from services.wechat import code2session

    try:
        session = await code2session(req.code)
    except RuntimeError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    openid = session.get("openid")
    if not openid:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="微信登录失败：无法获取 openid")

    user = db.query(User).filter(User.wechat_openid == openid).first()
    if not user:
        return WechatLoginResponse(need_bind=True)

    token = create_access_token({"user_id": user.id, "role_id": user.role_id, "school_id": user.school_id, "role": user.role.name if user.role else ""})
    log.info("微信登录成功: openid=%s user=%s", openid, user.username)
    rows = db.query(RolePermission.permission).filter(RolePermission.role_id == user.role_id).all()
    permissions = [r.permission for r in rows]
    return WechatLoginResponse(
        access_token=token,
        role=user.role.name if user.role else "",
        display_name=user.display_name,
        user_id=user.id,
        school_id=user.school_id,
        school_name=user.school.name if user.school else None,
        permissions=permissions,
    )


@router.post("/wechat/bind", response_model=OkResponse)
async def wechat_bind(
    req: WechatBindRequest,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    """将当前已登录用户绑定微信 openid"""
    from services.wechat import code2session

    if current_user.wechat_openid:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="已绑定微信，不可重复绑定")

    try:
        session = await code2session(req.code)
    except RuntimeError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    openid = session.get("openid")
    if not openid:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="微信登录失败：无法获取 openid")

    existing = db.query(User).filter(User.wechat_openid == openid).first()
    if existing:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="此微信已绑定其他账号")

    current_user.wechat_openid = openid
    db.commit()
    log.info("微信绑定成功: user=%s openid=%s", current_user.username, openid)
    return OkResponse(message="微信绑定成功")


@router.post("/wechat/register", response_model=TokenResponse)
async def wechat_register(
    req: WechatRegisterRequest,
    db: Annotated[Session, Depends(get_db)],
    _: Annotated[None, Depends(register_rate_limit)],
):
    """微信一键注册：通过 code 获取 openid，自动创建用户并返回 token"""
    from services.wechat import code2session

    try:
        session = await code2session(req.code)
    except RuntimeError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    openid = session.get("openid")
    if not openid:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="微信登录失败：无法获取 openid")

    existing = db.query(User).filter(User.wechat_openid == openid).first()
    if existing:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="此微信已注册，请直接登录")

    suffix = "".join(secrets.choice(string.ascii_lowercase + string.digits) for _ in range(8))
    username = f"wx_{suffix}"
    while db.query(User).filter(User.username == username).first():
        suffix = "".join(secrets.choice(string.ascii_lowercase + string.digits) for _ in range(8))
        username = f"wx_{suffix}"

    random_password = secrets.token_urlsafe(16)
    default_school = db.query(School).filter(School.name == "默认学校").first()
    if not default_school:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="默认学校不存在")
    student_role = db.query(Role).filter(Role.name == "student", Role.school_id == default_school.id).first()
    if not student_role:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="学生角色不存在")
    user = User(
        username=username,
        password_hash=hash_password(random_password),
        role_id=student_role.id,
        school_id=default_school.id,
        display_name=req.display_name,
        wechat_openid=openid,
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    token = create_access_token({"user_id": user.id, "role_id": user.role_id, "school_id": user.school_id, "role": user.role.name if user.role else ""})
    log.info("微信注册成功: openid=%s username=%s", openid, username)
    return TokenResponse(
        access_token=token,
        role=user.role.name if user.role else "",
        display_name=user.display_name,
        user_id=user.id,
        school_id=user.school_id,
        school_name=user.school.name if user.school else None,
    )


@router.get("/me", response_model=UserBrief)
def get_me(current_user: Annotated[User, Depends(get_current_user)]):
    return UserBrief(
        id=current_user.id,
        username=current_user.username,
        role=current_user.role.name if current_user.role else "",
        role_display_name=current_user.role.display_name if current_user.role else "",
        display_name=current_user.display_name,
        student_id=current_user.student_id,
        created_at=current_user.created_at,
    )
