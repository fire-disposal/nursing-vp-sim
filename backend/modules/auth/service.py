import asyncio
import logging
import math
from datetime import UTC, datetime, timedelta

from fastapi import Request
from sqlalchemy import text
from sqlalchemy.orm import Session

from core.access import accessible_school_ids, grantable_personas, granted_personas, resolve_access
from core.audit import (
    ACTION_AUTH_LOGIN_BLOCKED,
    ACTION_AUTH_LOGIN_FAILED,
    ACTION_AUTH_LOGIN_SUCCEEDED,
    ACTION_USER_CREATED,
    AUDIT_OUTCOME_DENIED,
    AUDIT_OUTCOME_SUCCESS,
    TARGET_TYPE_USER,
    record,
    record_detached,
)
from core.config import LOGIN_LOCK_SECONDS, LOGIN_LOCKOUT_ENABLED, LOGIN_MAX_FAILED_ATTEMPTS
from core.exceptions import AuthError, ConflictError, ValidationError
from core.identity import assert_student_identity_free, normalize_student_id
from core.personas import PERSONAS, is_super_admin
from core.security import create_access_token, hash_password, verify_password
from core.tenant import resolve_scope, visible_class, writable_school_id
from core.unit_of_work import unit_of_work
from models import (
    MEMBER_ROLE_STUDENT,
    MEMBER_ROLE_TEACHER,
    ClassMembership,
    School,
    User,
    UserSchoolPersona,
    UserSchoolProfile,
)
from schemas import (
    OkResponse,
    RegisterRequest,
    RegisterResponse,
    TokenResponse,
    UserBrief,
    UserMembershipItem,
    UserProfileUpdateRequest,
    UserSchoolGrant,
)

log = logging.getLogger(__name__)


class AuthService:
    def __init__(self, db: Session):
        self.db = db

    def build_token_response(self, user: User) -> TokenResponse:
        token = create_access_token({"user_id": user.id, "tv": user.token_version})
        # 登录/刷新不带请求头 → 默认视角；家院校没有授予时回落到第一所可用院校。
        ctx = resolve_access(self.db, user)
        return TokenResponse(
            access_token=token,
            display_name=user.display_name,
            user_id=user.id,
            permissions=sorted(ctx.permissions),
            personas=sorted(granted_personas(self.db, user, ctx.school_id)),
            active_persona=ctx.persona,
            is_platform=is_super_admin(user),
            gender=user.gender,
            avatar=user.avatar,
        )

    def _school_brand(self, school_id: int | None):
        """院校品牌（只取展示需要的列，不把院徽字节读进 /auth/me）。"""
        if school_id is None:
            return None
        return (
            self.db.query(
                School.name,
                School.theme_color,
                School.logo_updated_at,
                School.logo.isnot(None),
            )
            .filter(School.id == school_id)
            .first()
        )

    def _school_grants(self, user: User) -> list[UserSchoolGrant]:
        """该账号在各院校的授予（平台账号返回空：它派生全视角，不靠行）。"""
        if is_super_admin(user):
            return []
        if getattr(user, "school_id", None) is None:
            return []
        ids = accessible_school_ids(self.db, user)
        if not ids:
            return []
        names = {row[0]: row[1] for row in self.db.query(School.id, School.name).filter(School.id.in_(ids)).all()}
        home_school = getattr(user, "school_id", None)
        ordered = sorted(ids, key=lambda sid: (sid != home_school, names.get(sid, ""), sid))
        return [
            UserSchoolGrant(
                school_id=sid,
                school_name=names.get(sid, f"院校 #{sid}"),
                personas=sorted(granted_personas(self.db, user, sid)),
            )
            for sid in ordered
        ]

    def _user_to_brief(self, user: User) -> UserBrief:
        # 单用户多班级：返回 memberships 数组，不再取第一条（多班学生「显示 B 班」的老毛病）
        rows = [m for m in user.memberships if m.class_id is not None and m.class_ is not None]
        rows.sort(key=lambda m: (m.class_.cohort_label, m.class_.name, m.class_id))
        brand = self._school_brand(getattr(user, "school_id", None))
        active_school = getattr(user, "active_school_id", None) or getattr(user, "school_id", None)
        return UserBrief(
            id=user.id,
            username=user.username,
            personas=sorted(granted_personas(self.db, user, active_school)),
            is_platform=is_super_admin(user),
            school_id=getattr(user, "school_id", None),
            school_name=brand[0] if brand else None,
            school_theme_color=brand[1] if brand else None,
            school_has_logo=bool(brand[3]) if brand else False,
            school_logo_updated_at=brand[2] if brand else None,
            display_name=user.display_name,
            student_id=user.student_id,
            gender=user.gender,
            avatar=user.avatar,
            active_school_id=active_school,
            school_personas=self._school_grants(user),
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
            extra={"user_id": user.id, "action": "login"},
        )
        record_detached(
            request,
            action=ACTION_AUTH_LOGIN_SUCCEEDED,
            target_type="session",
            target_id=user.id,
            target_label=user.username,
            actor=user,
            outcome=AUDIT_OUTCOME_SUCCESS,
            payload={},
        )
        return user

    def _validate_new_personas(self, personas: list[str], actor: User) -> list[str]:
        unique = list(dict.fromkeys(personas or ["student"]))
        unknown = sorted(set(unique) - set(PERSONAS))
        if unknown:
            raise ValidationError(detail=f"未知视角: {unknown}")
        if "platform" in unique and not is_super_admin(actor):
            raise AuthError("无权创建平台账号", status_code=403)
        granted = set(grantable_personas(actor))
        for key in unique:
            if key not in granted:
                exceeded = sorted(
                    set(PERSONAS[key].permissions) - set(getattr(actor, "_permissions_cache", None) or ())
                )
                raise AuthError(f"无权授予视角 {key}：包含你没有的权限 {exceeded}", status_code=403)
        return unique

    def register(self, req: RegisterRequest, current_user: User, *, request: Request | None = None) -> RegisterResponse:
        existing = self.db.query(User).filter(User.username == req.username).first()
        if existing:
            raise ConflictError(detail="用户名已存在")

        personas = self._validate_new_personas(req.personas, current_user)
        # 平台账号不属于任何院校/班级。班级优先级曾排在平台判定之前，带 class_id 的
        # 请求会让平台号落进某校班级（从花名册/统计里冒出来），这里直接拒绝。
        if "platform" in personas and req.class_id is not None:
            raise ValidationError("平台账号不能加入班级")

        # 院校归属：班级优先（班级自带院校），否则取显式 school_id。
        # 平台账号不属于任何院校；其余账号必须落在有院校的范围内。
        scope = resolve_scope(self.db, current_user)
        cls = visible_class(self.db, scope, req.class_id) if req.class_id is not None else None
        if cls is not None:
            school_id = cls.school_id
        elif "platform" in personas:
            school_id = None
        else:
            school_id = writable_school_id(scope, req.school_id)

        student_id = normalize_student_id(req.student_id)
        if "student" in personas:
            # 本校同学号只能有一个学生账号：重复注册要在建号之前挡住，并说明撞了谁
            assert_student_identity_free(self.db, school_id=school_id, student_id=student_id)

        user = User(
            username=req.username,
            password_hash=hash_password(req.password),
            is_platform="platform" in personas,
            school_id=school_id,
            display_name=req.display_name,
            student_id=student_id,
            gender=req.gender,
        )
        with unit_of_work(self.db, conflict_detail="用户名已存在"):
            self.db.add(user)
            self.db.flush()
            if school_id is not None:
                for key in personas:
                    self.db.add(UserSchoolPersona(user_id=user.id, school_id=school_id, persona=key))
                if "student" in personas and student_id:
                    self.db.add(UserSchoolProfile(user_id=user.id, school_id=school_id, student_id=student_id))
            if req.class_id is not None:
                member_role = MEMBER_ROLE_TEACHER if "teacher" in personas else MEMBER_ROLE_STUDENT
                self.db.add(ClassMembership(user_id=user.id, class_id=req.class_id, member_role=member_role))
            record(
                self.db,
                action=ACTION_USER_CREATED,
                target_type=TARGET_TYPE_USER,
                target_id=user.id,
                target_label=user.username,
                request=request,
                payload={"personas": personas, "class_id": req.class_id, "school_id": school_id},
            )
        self.db.refresh(user)
        log.info(
            "用户注册: target_id=%d target_name=%s personas=%s",
            user.id,
            user.username,
            ",".join(personas),
            extra={
                "user_id": current_user.id,
                "actor_persona": current_user.active_persona,
                "action": "register",
            },
        )
        return RegisterResponse(
            id=user.id,
            username=user.username,
            personas=personas,
            display_name=user.display_name,
            student_id=user.student_id,
        )

    def get_me(self, current_user: User) -> UserBrief:
        brief = self._user_to_brief(current_user)
        # 权限集合由**当前视角**决定且可能刚被改动 → 每次 /auth/me 现取。
        # `get_current_user` 已按 X-View-Persona 解析并把结果挂到 `_permissions_cache`
        # （缺失时这里按默认视角解析，refresh/直调路径同样成立）。
        cached = getattr(current_user, "_permissions_cache", None)
        if cached is None:
            ctx = resolve_access(self.db, current_user)
            active, perms = ctx.persona, ctx.permissions
        else:
            perms = frozenset(cached)
            active = current_user.active_persona
            if active is None:
                active = resolve_access(self.db, current_user).persona
        brief.permissions = sorted(perms)
        brief.active_persona = active
        brief.personas = sorted(
            granted_personas(self.db, current_user, getattr(current_user, "active_school_id", None))
        )
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
