"""Database seeding — roles, admin user, test data, LLM config.

Extracted from main.py to keep the application entrypoint thin.
Called once during app startup (lifespan).
"""

import json
import logging
import os
from pathlib import Path

from core.config import DEEPSEEK_API_KEY, DEEPSEEK_BASE_URL
from core.database import SessionLocal
from core.roles import SYSTEM_PERMISSIONS, SYSTEM_ROLES
from core.security import hash_password
from infrastructure.llm import encrypt_api_key
from models import ApiSecret, Case, LLMConfig, Role, RolePermission, User, VoiceConfig

log = logging.getLogger(__name__)

_PROJECT_ROOT = Path(__file__).resolve().parent.parent


def seed_all() -> None:
    """Run all seed operations. Idempotent — safe to call multiple times."""
    _seed_data()
    _seed_cases()
    _seed_llm()
    _seed_voice()


def _seed_data() -> None:
    db = SessionLocal()
    try:
        if db.query(Role).count() > 0:
            return

        # 1. 创建系统角色（无 school_id），并同步权限
        role_ids = {}
        for name, display_name in SYSTEM_ROLES:
            role = db.query(Role).filter(Role.name == name).first()
            if not role:
                role = Role(name=name, display_name=display_name, is_system=True)
                db.add(role)
                db.flush()
            role_ids[name] = role.id
        db.commit()

        # 清理并重建角色权限
        for role_name, perms in SYSTEM_PERMISSIONS.items():
            rid = role_ids.get(role_name)
            if not rid:
                continue
            existing = {rp.permission for rp in db.query(RolePermission).filter(RolePermission.role_id == rid).all()}
            target = set(perms)
            for p in existing - target:
                db.query(RolePermission).filter(RolePermission.role_id == rid, RolePermission.permission == p).delete()
            for p in target - existing:
                db.add(RolePermission(role_id=rid, permission=p))
        db.commit()

        # 2. 超级管理员
        username = os.getenv("SEED_ADMIN_USERNAME", "admin")
        password = os.getenv("SEED_ADMIN_PASSWORD")
        if not password:
            raise RuntimeError("SEED_ADMIN_PASSWORD 环境变量未设置")
        sa_role_id = role_ids.get("super_admin")
        admin_user = db.query(User).filter(User.username == username).first()
        if admin_user:
            if sa_role_id is not None and admin_user.role_id != sa_role_id:
                admin_user.role_id = sa_role_id
                db.commit()
                log.debug("超级管理员角色已修正 (%s → super_admin)", username)
        else:
            db.add(
                User(
                    username=username,
                    password_hash=hash_password(password),
                    role_id=sa_role_id,
                    display_name="超级管理员",
                )
            )
            db.commit()
            log.debug("超级管理员已创建 (%s)", username)

        # 4. 测试学生 (仅首次初始化)
        if db.query(User).filter(User.username != username).count() == 0:
            student_role_id = role_ids.get("student")
            test_genders = ["男", "女", "男", "女", "男"]
            for i in range(1, 6):
                db.add(
                    User(
                        username=f"student{i}",
                        password_hash=hash_password("123456"),
                        role_id=student_role_id,
                        display_name=f"学生{i}",
                        student_id=f"202400{i:02d}",
                        gender=test_genders[i - 1],
                    )
                )
            db.commit()
            log.debug("测试学生已创建 (student1-5 / 123456)")

    finally:
        db.close()


def _seed_cases() -> None:
    """Import cases from data/cases/*.json. Idempotent — skips existing names."""
    db = SessionLocal()
    try:
        existing_names = {c.name for c in db.query(Case.name).all()}
        cases_dir = _PROJECT_ROOT / "data" / "cases"
        imported = 0
        skipped = 0
        for fpath in sorted(cases_dir.glob("*.json")):
            try:
                d = json.loads(fpath.read_text(encoding="utf-8"))
                name = d.get("name", fpath.stem)
                if name in existing_names:
                    skipped += 1
                    continue
                db.add(
                    Case(
                        name=name,
                        description=d.get("description", ""),
                        training_type=d.get("training_type", "history_taking"),
                        difficulty=d.get("difficulty", 1),
                        time_limit_minutes=d.get("time_limit", 20),
                        case_data=d,
                    )
                )
                existing_names.add(name)
                imported += 1
            except (OSError, json.JSONDecodeError) as e:
                log.warning("病例文件读取失败 %s: %s", fpath.name, e)
        if imported:
            db.commit()
        log.debug("病例导入完成: 新增 %d, 跳过 %d", imported, skipped)
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
            needs_sync = False
            if matched.encrypted_key != env_encrypted:
                matched.encrypted_key = env_encrypted
                needs_sync = True
            if matched.base_url != DEEPSEEK_BASE_URL:
                matched.base_url = DEEPSEEK_BASE_URL
                needs_sync = True
            if float(matched.price_input_per_1m or 0) == 0:
                matched.price_input_per_1m = 1.0
                needs_sync = True
            if float(matched.price_output_per_1m or 0) == 0:
                matched.price_output_per_1m = 2.0
                needs_sync = True
            if needs_sync:
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

        purposes = ["scoring", "scoring_feedback", "patient_chat", "qa", "case_generation", "*"]
        for purpose in purposes:
            cfg = db.query(LLMConfig).filter(LLMConfig.secret_id == secret.id, LLMConfig.purpose == purpose).first()
            if not cfg:
                db.add(LLMConfig(secret_id=secret.id, purpose=purpose, status="active"))
        db.commit()
        log.debug("LLM 种子完成: secret#%d + %d 用途", secret.id, len(purposes))
    except Exception:
        log.exception("LLM 种子失败，使用环境变量兜底")
        db.rollback()
    finally:
        db.close()


def _seed_voice() -> None:
    db = SessionLocal()
    try:
        active = db.query(VoiceConfig).filter(VoiceConfig.is_active == True).first()
        if not active:
            db.add(
                VoiceConfig(
                    provider="volcengine",
                    api_key_enc="",
                    api_key_suffix="",
                    tts_resource_id="seed-tts-2.0",
                    tts_speaker="zh_female_vv_uranus_bigtts",
                    tts_model="seed-tts-2.0-standard",
                    tts_sample_rate=24000,
                    tts_format="mp3",
                    tts_timeout=8,
                    asr_resource_id="volc.bigasr.sauc.duration",
                    asr_sample_rate=16000,
                    asr_endpoint_mode="bigmodel_nostream",
                    monthly_budget=200.0,
                    is_active=True,
                )
            )
            db.commit()
            log.info("VoiceConfig seed: no active config found, created placeholder")
    except Exception:
        log.exception("VoiceConfig 种子失败")
        db.rollback()
    finally:
        db.close()
