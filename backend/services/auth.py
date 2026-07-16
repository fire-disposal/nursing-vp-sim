import logging

from sqlalchemy import text
from sqlalchemy.orm import Session

from core.exceptions import AuthError, ConflictError, ValidationError
from core.login_strategies import get_strategy_registry
from core.security import create_access_token, hash_password, load_role_permissions, verify_password
from core.unit_of_work import unit_of_work
from models import Class, Role, User, UserClass
from schemas import (
    OkResponse,
    RegisterRequest,
    RegisterResponse,
    TokenResponse,
    UserBrief,
    UserProfileUpdateRequest,
)

log = logging.getLogger(__name__)


class AuthService:
    def __init__(self, db: Session):
        self.db = db

    def build_token_response(self, user: User) -> TokenResponse:
        token = create_access_token(
            {
                "user_id": user.id,
                "role_id": user.role_id,
                "role": user.role.name if user.role else "",
                "tv": user.token_version,
            }
        )
        permissions = list(load_role_permissions(self.db, user.role_id))
        return TokenResponse(
            access_token=token,
            role=user.role.name if user.role else "",
            display_name=user.display_name,
            user_id=user.id,
            permissions=permissions,
            gender=user.gender,
            avatar=user.avatar,
        )

    def _user_to_brief(self, user: User) -> UserBrief:
        ucs = user.user_classes
        first = ucs[0] if ucs else None
        cls = first.class_ if first else None
        return UserBrief(
            id=user.id,
            username=user.username,
            role=user.role.name if user.role else "",
            role_display_name=user.role.display_name if user.role else "",
            display_name=user.display_name,
            student_id=user.student_id,
            gender=user.gender,
            avatar=user.avatar,
            class_id=cls.id if cls else None,
            class_name=cls.name if cls else None,
            grade_name=cls.grade.name if (cls and cls.grade) else None,
            created_at=user.created_at,
        )

    async def login(self, username: str, password: str) -> User:
        strategy = get_strategy_registry()["password"](self.db)
        user = await strategy.authenticate({"username": username, "password": password})
        if user is None:
            log.warning("登录失败: username=%s", username, extra={"action": "login_failed"})
            raise AuthError(detail="用户名或密码错误")
        log.info(
            "登录成功: username=%s",
            username,
            extra={"user_id": user.id, "user_role": user.role.name if user.role else "", "action": "login"},
        )
        return user

    def register(self, req: RegisterRequest, current_user: User) -> RegisterResponse:
        existing = self.db.query(User).filter(User.username == req.username).first()
        if existing:
            raise ConflictError(detail="用户名已存在")

        if req.role not in ("student", "teacher"):
            raise ValidationError(detail="角色必须为 student 或 teacher")

        role_obj = self.db.query(Role).filter(Role.name == req.role).first()
        if not role_obj:
            raise ValidationError(detail="角色不存在")

        if req.class_id is not None:
            cls = self.db.query(Class).filter(Class.id == req.class_id).first()
            if not cls:
                raise ValidationError(detail="班级不存在")

        user = User(
            username=req.username,
            password_hash=hash_password(req.password),
            role_id=role_obj.id,
            display_name=req.display_name,
            student_id=req.student_id,
            gender=req.gender,
        )
        with unit_of_work(self.db, conflict_detail="用户名已存在"):
            self.db.add(user)
            self.db.flush()
            if req.class_id is not None:
                self.db.add(UserClass(user_id=user.id, class_id=req.class_id))
        self.db.refresh(user)
        log.info(
            "用户注册: target_id=%d target_name=%s role=%s",
            user.id,
            user.username,
            user.role.name if user.role else "",
            extra={
                "user_id": current_user.id,
                "user_role": current_user.role.name if current_user.role else "",
                "action": "register",
            },
        )
        return RegisterResponse(
            id=user.id,
            username=user.username,
            role=user.role.name if user.role else "",
            display_name=user.display_name,
            student_id=user.student_id,
        )

    def get_me(self, current_user: User) -> UserBrief:
        return self._user_to_brief(current_user)

    def update_me(self, req: UserProfileUpdateRequest, current_user: User) -> UserBrief:
        if req.display_name is not None:
            current_user.display_name = req.display_name
        if req.student_id is not None:
            current_user.student_id = req.student_id or None
        if req.gender is not None:
            current_user.gender = req.gender or None
        if req.avatar is not None:
            current_user.avatar = req.avatar or None
        self.db.commit()
        self.db.refresh(current_user)
        log.info("个人信息更新: user_id=%d", current_user.id)
        return self._user_to_brief(current_user)

    def refresh_token(self, current_user: User) -> TokenResponse:
        log.info("Token 刷新: user_id=%d", current_user.id)
        return self.build_token_response(current_user)

    def change_password(self, old_password: str, new_password: str, current_user: User) -> OkResponse:
        if not verify_password(old_password, current_user.password_hash):
            raise AuthError(detail="原密码错误")
        current_user.password_hash = hash_password(new_password)
        result = self.db.execute(
            text("UPDATE users SET token_version = token_version + 1 WHERE id = :id RETURNING token_version"),
            {"id": current_user.id},
        )
        new_tv = result.scalar()
        self.db.commit()
        log.info("密码修改: user_id=%d (tv=%d)", current_user.id, new_tv)
        return OkResponse(message="密码修改成功")

    def logout(self, current_user: User) -> OkResponse:
        result = self.db.execute(
            text("UPDATE users SET token_version = token_version + 1 WHERE id = :id RETURNING token_version"),
            {"id": current_user.id},
        )
        new_tv = result.scalar()
        self.db.commit()
        log.info("登出: user_id=%d (tv=%d)", current_user.id, new_tv)
        return OkResponse(message="已登出")
