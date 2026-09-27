import asyncio
import logging
import math
from datetime import UTC, datetime, timedelta

from fastapi import Request
from sqlalchemy import text
from sqlalchemy.orm import Session

from core.audit import (
    ACTION_AUTH_LOGIN_BLOCKED,
    ACTION_AUTH_LOGIN_FAILED,
    ACTION_AUTH_LOGIN_SUCCEEDED,
    ACTION_USER_CREATED,
    AUDIT_OUTCOME_DENIED,
    TARGET_TYPE_USER,
    record,
    record_detached,
)
from core.config import LOGIN_LOCK_SECONDS, LOGIN_LOCKOUT_ENABLED, LOGIN_MAX_FAILED_ATTEMPTS
from core.exceptions import AuthError, ConflictError, ValidationError
from core.security import create_access_token, hash_password, load_role_permissions, verify_password
from core.unit_of_work import unit_of_work
from models import MEMBER_ROLE_STUDENT, MEMBER_ROLE_TEACHER, Class, ClassMembership, Role, User
from schemas import (
    OkResponse,
    RegisterRequest,
    RegisterResponse,
    TokenResponse,
    UserBrief,
    UserMembershipItem,
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
        # 单用户多班级：返回 memberships 数组，不再取第一条（多班学生「显示 B 班」的老毛病）
        rows = [m for m in user.memberships if m.class_id is not None and m.class_ is not None]
        rows.sort(key=lambda m: (m.class_.cohort_label, m.class_.name, m.class_id))
        return UserBrief(
            id=user.id,
            username=user.username,
            role=user.role.name if user.role else "",
            role_display_name=user.role.display_name if user.role else "",
            display_name=user.display_name,
            student_id=user.student_id,
            gender=user.gender,
            avatar=user.avatar,
            memberships=[
                UserMembershipItem(
                    class_id=m.class_id,
                    class_name=m.class_.name,
                    cohort_label=m.class_.cohort_label,
                    member_role=m.member_role,
                    joined_at=m.joined_at,
                )
                for m in rows
            ],
            created_at=user.created_at,
        )

    def _register_failed_attempt(self, user: User, request: Request | None, now: datetime) -> None:
        """密码错误时递增失败计数；达到阈值则置锁定期并留一行审计。

        计数/锁定期与业务写共用一次提交（unit_of_work），锁定审计走独立 session
        （record_detached）——它记录的是"发生了锁定"，即使随后请求回滚也要留下。

        仅在 `LOGIN_LOCKOUT_ENABLED=true` 时被调用（默认关闭，见 `core/config.py` 的说明）。
        """
        user.failed_login_count += 1
        locked = user.failed_login_count >= LOGIN_MAX_FAILED_ATTEMPTS
        locked_until: datetime | None = None
        if locked:
            locked_until = now + timedelta(seconds=LOGIN_LOCK_SECONDS)
            user.locked_until = locked_until
        failed_count = user.failed_login_count
        with unit_of_work(self.db):
            self.db.add(user)
        if locked_until is None:
            return
        log.warning(
            "登录失败达阈值，账号已锁定: username=%s failed_count=%d locked_until=%s",
            user.username,
            failed_count,
            locked_until.isoformat(),
            extra={"action": "login_blocked"},
        )
        record_detached(
            request,
            action=ACTION_AUTH_LOGIN_BLOCKED,
            target_type=TARGET_TYPE_USER,
            target_id=user.id,
            target_label=user.username,
            outcome=AUDIT_OUTCOME_DENIED,
            payload={
                "failed_count": failed_count,
                "locked_until": locked_until.isoformat(),
                "reason": "max_failed_attempts",
            },
        )

    async def login(self, username: str, password: str, *, request: Request | None = None) -> User:
        user = self.db.query(User).filter(User.username == username).first()
        now = datetime.now(UTC)
        # 锁定期内一律拒绝，即便密码正确也不放行。
        # 文案**明确说明已锁定**并给出剩余时间：维护者口径是"完成度优先于安全性"（2026-09-27）——
        # 让被锁的真人得到可行动的信息，比防"用户名枚举"更重要（本平台是内部教学系统，
        # 用户名的可见性不是秘密）。整个策略由 LOGIN_LOCKOUT_ENABLED 控制（默认关闭）：
        # 关闭时连"读锁定期"这一步都不做，存量 locked_until 不会拦住任何人 —— 需要立刻恢复访问时关掉开关即可。
        if LOGIN_LOCKOUT_ENABLED and user is not None and user.locked_until is not None and user.locked_until > now:
            remaining_minutes = max(1, math.ceil((user.locked_until - now).total_seconds() / 60))
            log.warning(
                "登录被拒（账号锁定中）: username=%s locked_until=%s",
                username,
                user.locked_until.isoformat(),
                extra={"action": "login_blocked"},
            )
            record_detached(
                request,
                action=ACTION_AUTH_LOGIN_FAILED,
                target_type=TARGET_TYPE_USER,
                target_id=user.id,
                target_label=user.username,
                outcome=AUDIT_OUTCOME_DENIED,
                payload={"reason": "locked", "remaining_minutes": remaining_minutes},
            )
            raise AuthError(detail=f"账号已锁定，请 {remaining_minutes} 分钟后再试", status_code=403)
        if user is None or not await asyncio.to_thread(verify_password, password, user.password_hash):
            log.warning("登录失败: username=%s", username, extra={"action": "login_failed"})
            # 仅对真实存在的用户计数：未知用户不落任何状态（否则攻击者能凭空制造账号状态）。
            # 计数/锁定受开关控制（默认关闭 → 不写任何状态）。
            if user is not None and LOGIN_LOCKOUT_ENABLED:
                self._register_failed_attempt(user, request, now)
            # 登录失败是账户安全的第一信号 → 独立 session 留痕。
            # 未知用户与密码错误记同一种 reason，避免审计表本身成为用户名枚举通道。
            record_detached(
                request,
                action=ACTION_AUTH_LOGIN_FAILED,
                target_type="session",
                target_label=username[:120],
                outcome="failure",
                payload={"reason": "bad_credentials"},
            )
            raise AuthError(detail="用户名或密码错误")
        if not user.is_active:
            record_detached(
                request,
                action=ACTION_AUTH_LOGIN_FAILED,
                target_type="session",
                target_id=user.id,
                target_label=user.username,
                outcome="denied",
                payload={"reason": "inactive"},
            )
            raise AuthError(detail="账号已被禁用，请联系管理员", status_code=403)
        # 成功登录 → 清零此前累计的失败计数与锁定期（只在确有残留时提交）。
        if user.failed_login_count or user.locked_until is not None:
            user.failed_login_count = 0
            user.locked_until = None
            with unit_of_work(self.db):
                self.db.add(user)
        log.info(
            "登录成功: username=%s",
            username,
            extra={"user_id": user.id, "user_role": user.role.name if user.role else "", "action": "login"},
        )
        record_detached(
            request,
            action=ACTION_AUTH_LOGIN_SUCCEEDED,
            target_type="session",
            target_id=user.id,
            target_label=user.username,
            actor=user,
            payload={},
        )
        return user

    def register(self, req: RegisterRequest, current_user: User, *, request: Request | None = None) -> RegisterResponse:
        existing = self.db.query(User).filter(User.username == req.username).first()
        if existing:
            raise ConflictError(detail="用户名已存在")

        if req.role not in ("student", "teacher"):
            raise ValidationError(detail="角色必须为 student 或 teacher")

        role_obj = self.db.query(Role).filter(Role.name == req.role).first()
        if not role_obj:
            raise ValidationError(detail="角色不存在")

        # 反越权（RB-9）：只能创建自身权限集合内的角色，否则等于相对自身的垂直提权
        # （今天 user_manage 只属于 super_admin 故不可利用，但自定义角色一出现就会暴露）
        grantable = set(load_role_permissions(self.db, current_user.role_id))
        exceeded = sorted(set(load_role_permissions(self.db, role_obj.id)) - grantable)
        if exceeded:
            raise AuthError(
                f"无权创建「{role_obj.display_name}」账号：目标角色包含你自身没有的权限 {exceeded}", status_code=403
            )

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
                member_role = MEMBER_ROLE_TEACHER if req.role == "teacher" else MEMBER_ROLE_STUDENT
                self.db.add(ClassMembership(user_id=user.id, class_id=req.class_id, member_role=member_role))
            record(
                self.db,
                action=ACTION_USER_CREATED,
                target_type=TARGET_TYPE_USER,
                target_id=user.id,
                target_label=user.username,
                request=request,
                payload={"role": req.role, "class_id": req.class_id},
            )
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
        brief = self._user_to_brief(current_user)
        # 权限集合由角色决定且可能刚被改动 → 每次 /auth/me 现取（load_role_permissions 自身有 2s 缓存）
        if current_user.role_id is not None:
            brief.permissions = sorted(load_role_permissions(self.db, current_user.role_id))
        return brief

    def update_me(self, req: UserProfileUpdateRequest, current_user: User) -> UserBrief:
        if req.display_name is not None:
            current_user.display_name = req.display_name
        if req.student_id is not None:
            current_user.student_id = req.student_id or None
        if req.gender is not None:
            current_user.gender = req.gender or None
        if req.avatar is not None:
            current_user.avatar = req.avatar or None
        with unit_of_work(self.db):
            pass
        self.db.refresh(current_user)
        log.info("个人信息更新: user_id=%d", current_user.id)
        return self._user_to_brief(current_user)

    def refresh_token(self, current_user: User) -> TokenResponse:
        log.info("Token 刷新: user_id=%d", current_user.id)
        return self.build_token_response(current_user)

    def change_password(self, old_password: str, new_password: str, current_user: User) -> OkResponse:
        if not verify_password(old_password, current_user.password_hash):
            raise AuthError(detail="原密码错误")
        with unit_of_work(self.db):
            current_user.password_hash = hash_password(new_password)
            result = self.db.execute(
                text("UPDATE users SET token_version = token_version + 1 WHERE id = :id RETURNING token_version"),
                {"id": current_user.id},
            )
            new_tv = result.scalar()
        log.info("密码修改: user_id=%d (tv=%d)", current_user.id, new_tv)
        return OkResponse(message="密码修改成功")

    def logout(self, current_user: User) -> OkResponse:
        with unit_of_work(self.db):
            result = self.db.execute(
                text("UPDATE users SET token_version = token_version + 1 WHERE id = :id RETURNING token_version"),
                {"id": current_user.id},
            )
            new_tv = result.scalar()
        log.info("登出: user_id=%d (tv=%d)", current_user.id, new_tv)
        return OkResponse(message="已登出")
