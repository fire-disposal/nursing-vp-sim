"""Database seeding — default school, roles, admin user, test data, LLM config.

Extracted from main.py to keep the application entrypoint thin.
Called once during app startup (lifespan).
"""

import json
import logging
import os
from pathlib import Path

from core.config import DEEPSEEK_API_KEY, DEEPSEEK_BASE_URL, DEEPSEEK_MODEL
from core.database import SessionLocal
from core.roles import SYSTEM_PERMISSIONS, SYSTEM_ROLES
from core.security import hash_password
from infrastructure.llm import encrypt_api_key
from models import ApiSecret, Case, LLMConfig, Role, RolePermission, Rubric, School, User

log = logging.getLogger(__name__)

_PROJECT_ROOT = Path(__file__).resolve().parent.parent


def seed_all() -> None:
    """Run all seed operations. Idempotent — safe to call multiple times."""
    _seed_data()
    _seed_llm()


def _seed_data() -> None:
    db = SessionLocal()
    try:
        if db.query(School).count() > 0:
            return

        # 1. 确保默认学校存在
        school = db.query(School).filter(School.name == "默认学校").first()
        if not school:
            school = School(name="默认学校")
            db.add(school)
            db.flush()
            log.debug("默认学校已创建")

        # 2. 确保系统模板角色存在，并同步权限 (school_id=NULL)
        template_roles = {}
        for name, display_name in SYSTEM_ROLES:
            template = db.query(Role).filter(Role.name == name, Role.school_id.is_(None)).first()
            if not template:
                template = Role(name=name, display_name=display_name, school_id=None, is_system=True)
                db.add(template)
                db.flush()
            template_roles[name] = template.id
        db.commit()

        # 清理并重建模板角色的权限
        for role_name, perms in SYSTEM_PERMISSIONS.items():
            rid = template_roles.get(role_name)
            if not rid:
                continue
            existing = {rp.permission for rp in db.query(RolePermission).filter(RolePermission.role_id == rid).all()}
            target = set(perms)
            for p in existing - target:
                db.query(RolePermission).filter(RolePermission.role_id == rid, RolePermission.permission == p).delete()
            for p in target - existing:
                db.add(RolePermission(role_id=rid, permission=p))
        db.commit()

        # 3. 确保默认学校的角色存在，并同步权限
        school_role_ids = {}
        for name, display_name in SYSTEM_ROLES:
            role = db.query(Role).filter(Role.name == name, Role.school_id == school.id).first()
            if not role:
                role = Role(name=name, display_name=display_name, school_id=school.id, is_system=True)
                db.add(role)
                db.flush()
            school_role_ids[name] = role.id
        db.commit()

        for role_name, perms in SYSTEM_PERMISSIONS.items():
            rid = school_role_ids.get(role_name)
            if not rid:
                continue
            existing = {rp.permission for rp in db.query(RolePermission).filter(RolePermission.role_id == rid).all()}
            target = set(perms)
            for p in existing - target:
                db.query(RolePermission).filter(RolePermission.role_id == rid, RolePermission.permission == p).delete()
            for p in target - existing:
                db.add(RolePermission(role_id=rid, permission=p))
        db.commit()

        # 4. 评分标准
        if db.query(Rubric).count() == 0:
            rubric_path = _PROJECT_ROOT / "data" / "rubrics" / "nursing_history_v1.json"
            if rubric_path.exists():
                try:
                    data = json.loads(rubric_path.read_text(encoding="utf-8"))
                except (OSError, json.JSONDecodeError) as e:
                    log.warning("评分标准文件读取失败: %s", e)
                    data = {}
                db.add(
                    Rubric(
                        name=data.get("id", "nursing_history_v1"),
                        version=data.get("version", "1.0"),
                        description=data.get("name", ""),
                        total_max=data.get("total_max", 100),
                        raw_max=data.get("raw_max", 57),
                        raw_scale=data.get("raw_scale", 3),
                        dimensions=data.get("dimensions", []),
                        is_active=True,
                    )
                )
                db.commit()
                log.debug("评分标准已导入")

        # 5. 超级管理员
        username = os.getenv("SEED_ADMIN_USERNAME", "admin")
        password = os.getenv("SEED_ADMIN_PASSWORD")
        if not password:
            raise RuntimeError("SEED_ADMIN_PASSWORD 环境变量未设置")
        sa_role_id = school_role_ids.get("super_admin")
        admin_user = db.query(User).filter(User.username == username).first()
        if admin_user:
            if sa_role_id is not None and (admin_user.role_id != sa_role_id or admin_user.school_id != school.id):
                admin_user.role_id = sa_role_id
                admin_user.school_id = school.id
                db.commit()
                log.debug("超级管理员角色已修正 (%s → super_admin)", username)
        else:
            db.add(
                User(
                    username=username,
                    password_hash=hash_password(password),
                    role_id=sa_role_id,
                    school_id=school.id,
                    display_name="超级管理员",
                )
            )
            db.commit()
            log.debug("超级管理员已创建 (%s)", username)

        # 6. 测试学生和病例 (仅首次初始化)
        if db.query(User).filter(User.username != username).count() == 0:
            student_role_id = school_role_ids.get("student")
            test_genders = ["男", "女", "男", "女", "男"]
            for i in range(1, 6):
                db.add(
                    User(
                        username=f"student{i}",
                        password_hash=hash_password("123456"),
                        role_id=student_role_id,
                        school_id=school.id,
                        display_name=f"学生{i}",
                        student_id=f"202400{i:02d}",
                        gender=test_genders[i - 1],
                    )
                )
            log.debug("测试学生已创建 (student1-5 / 123456)")

            cases_dir = _PROJECT_ROOT / "data" / "cases"
            case_count = 0
            for fpath in sorted(cases_dir.glob("*.json")):
                try:
                    d = json.loads(fpath.read_text(encoding="utf-8"))
                    db.add(
                        Case(
                            name=d.get("name", fpath.stem),
                            description=d.get("description", ""),
                            case_data=d,
                            school_id=None,
                        )
                    )
                    case_count += 1
                except (OSError, json.JSONDecodeError) as e:
                    log.warning("病例文件读取失败 %s: %s", fpath.name, e)
            db.commit()
            log.debug("内置病例已导入 (%d)", case_count)
    finally:
        db.close()


def _seed_llm() -> None:
    db = SessionLocal()
    try:
        env_encrypted = encrypt_api_key(DEEPSEEK_API_KEY)
        suffix = DEEPSEEK_API_KEY[-4:]

        # 清理重复密钥（同 label + suffix 只保留第一个）
        dupes = (
            db.query(ApiSecret)
            .filter(
                ApiSecret.label == "初始服务密钥",
                ApiSecret.key_suffix == suffix,
            )
            .order_by(ApiSecret.id)
            .all()
        )
        if len(dupes) > 1:
            for d in dupes[1:]:
                db.query(LLMConfig).filter(LLMConfig.secret_id == d.id).delete()
                db.delete(d)
            db.commit()
            log.debug("清理重复密钥: %d → %d", len(dupes), 1)

        matched = dupes[0] if dupes else None
        if matched:
            changed = any(
                [
                    matched.base_url != DEEPSEEK_BASE_URL,
                    float(matched.price_input_per_1m or 0) == 0,
                    float(matched.price_output_per_1m or 0) == 0,
                ]
            )
            if matched.base_url != DEEPSEEK_BASE_URL:
                matched.base_url = DEEPSEEK_BASE_URL
            if float(matched.price_input_per_1m or 0) == 0:
                matched.price_input_per_1m = 1.0
            if float(matched.price_output_per_1m or 0) == 0:
                matched.price_output_per_1m = 2.0
            if changed:
                db.commit()
                log.debug("种子密钥已同步 (ID=%d)", matched.id)
            secret = matched
        else:
            secret = ApiSecret(
                label="初始服务密钥",
                encrypted_key=env_encrypted,
                key_suffix=suffix,
                base_url=DEEPSEEK_BASE_URL,
                price_input_per_1m=1.0,
                price_output_per_1m=2.0,
            )
            db.add(secret)
            db.flush()
            log.debug("种子密钥已创建")

        purposes = [
            ("scoring", DEEPSEEK_MODEL),
            ("patient_chat", DEEPSEEK_MODEL),
            ("qa", DEEPSEEK_MODEL),
            ("case_generation", DEEPSEEK_MODEL),
            ("*", DEEPSEEK_MODEL),
        ]
        for purpose, model in purposes:
            cfg = db.query(LLMConfig).filter(LLMConfig.secret_id == secret.id, LLMConfig.purpose == purpose).first()
            if cfg:
                if cfg.model != model:
                    cfg.model = model
            else:
                db.add(LLMConfig(secret_id=secret.id, model=model, purpose=purpose))
        db.commit()
        log.debug("LLM 种子完成: secret#%d + %d 用途", secret.id, len(purposes))
    except Exception:
        log.exception("LLM 种子失败，使用环境变量兜底")
        db.rollback()
    finally:
        db.close()
