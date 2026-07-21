import logging
from typing import Annotated

from fastapi import APIRouter, Depends, Request

from core.deps import CurrentUser, DbSession
from core.rate_limits import login_rate_limit, register_rate_limit, reset_login_limit
from core.security import decode_token_allow_expired, require_permission
from models import User
from schemas import (
    ChangePasswordRequest,
    LoginRequest,
    OkResponse,
    RegisterRequest,
    RegisterResponse,
    TokenResponse,
    UserBrief,
    UserProfileUpdateRequest,
)
from services.auth import AuthService

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/auth", tags=["认证"])


@router.post("/login", response_model=TokenResponse)
async def login(
    req: LoginRequest,
    request: Request,
    db: DbSession,
    _: Annotated[None, Depends(login_rate_limit)],
):
    service = AuthService(db)
    user = await service.login(req.username, req.password)
    await reset_login_limit(request)
    return service.build_token_response(user)


@router.post("/register", response_model=RegisterResponse)
def register(
    req: RegisterRequest,
    current_user: Annotated[User, Depends(require_permission("user_manage"))],
    db: DbSession,
    _: Annotated[None, Depends(register_rate_limit)],
):
    return AuthService(db).register(req, current_user)


@router.get("/me", response_model=UserBrief)
def get_me(
    current_user: CurrentUser,
    db: DbSession,
):
    return AuthService(db).get_me(current_user)


@router.put("/me", response_model=UserBrief)
def update_me(
    req: UserProfileUpdateRequest,
    current_user: CurrentUser,
    db: DbSession,
):
    return AuthService(db).update_me(req, current_user)


@router.post("/refresh", response_model=TokenResponse)
def refresh_token(
    current_user: Annotated[User, Depends(decode_token_allow_expired)],
    db: DbSession,
):
    return AuthService(db).refresh_token(current_user)


@router.put("/change-password", response_model=OkResponse)
def change_password(
    req: ChangePasswordRequest,
    current_user: CurrentUser,
    db: DbSession,
):
    return AuthService(db).change_password(req.old_password, req.new_password, current_user)


@router.post("/logout", response_model=OkResponse)
def logout(
    current_user: CurrentUser,
    db: DbSession,
):
    return AuthService(db).logout(current_user)
