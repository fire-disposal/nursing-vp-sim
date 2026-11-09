"""Database seeding — platform/admin users, test data, LLM config.

Extracted from main.py to keep the application entrypoint thin.
Called once during app startup (lifespan).
"""

import json
import logging
import os
from datetime import UTC, datetime
from pathlib import Path

from core.config import DEEPSEEK_API_KEY, DEEPSEEK_BASE_URL
from core.database import SessionLocal
from core.security import hash_password
from core.time_limits import DEFAULT_TIME_LIMIT_MINUTES
from models import (
    CASE_STATUS_ARCHIVED,
    CASE_STATUS_PUBLISHED,
    ApiSecret,
    Case,
    School,
    User,
    UserSchoolPersona,
    VoiceConfig,
)
from modules.cases.builtin_sync import is_locally_edited, with_seed_bookmark
from modules.cases.revisions import append_revision, content_matches_current_revision

log = logging.getLogger(__name__)

_PROJECT_ROOT = Path(__file__).resolve().parent


def seed_all() -> None:
    """Run all seed operations. Idempotent — safe to call multiple times."""
    _seed_data()
    _seed_cases()
    _seed_llm()
    _seed_voice()


def _seed_user(
    db,
    *,
    personas: list[str],
    is_platform: bool,
    env_username: str,
    env_password: str,
    default_username: str,
    default_display: str,
    school_id: int | None,
) -> None:
    """Seed one system user by persona set. Idempotent — creates only when missing."""
    username = os.getenv(env_username, default_username)
    password = os.getenv(env_password)
    if not password:
        log.warning("%s 未设置，跳过 %s 种子用户", env_password, default_display)
        return
    existing = db.query(User).filter(User.username == username).first()
    if existing:
        if is_platform and not existing.is_platform:
            existing.is_platform = True
            db.commit()
            log.debug("%s 平台标记已修正 (%s)", default_display, username)
        return
    user = User(
        username=username,
        password_hash=hash_password(password),
        display_name=default_display,
        school_id=school_id,
        is_platform=is_platform,
    )
    db.add(user)
    db.flush()
    if school_id is not None:
        for persona in personas:
            db.add(UserSchoolPersona(user_id=user.id, school_id=school_id, persona=persona))
    db.commit()
    log.debug("%s 已创建 (%s)", default_display, username)


def _seed_data() -> None:
    db = SessionLocal()
    try:
        first_run = db.query(User).count() == 0
        if not first_run:
            return

        # 平台账号不属于任何院校；其余种子账号挂到示例院校（避免 school_id 为空 = 平台全局）
        school = db.query(School).first()
        if school is None:
            school = School(name="示例院校", created_at=datetime.now(UTC))
            db.add(school)
            db.flush()

        _seed_user(
            db,
            personas=[],
            is_platform=True,
            env_username="SEED_ADMIN_USERNAME",
            env_password="SEED_ADMIN_PASSWORD",
            default_username="admin",
            default_display="超级管理员",
            school_id=None,
        )
        _seed_user(
            db,
            personas=["admin", "teacher", "student"],
            is_platform=False,
            env_username="SEED_OPERATOR_USERNAME",
            env_password="SEED_OPERATOR_PASSWORD",
            default_username="admin2",
            default_display="管理员",
            school_id=school.id,
        )
        _seed_user(
            db,
            personas=["teacher"],
            is_platform=False,
            env_username="SEED_TEACHER_USERNAME",
            env_password="SEED_TEACHER_PASSWORD",
            default_username="teacher1",
            default_display="教师",
            school_id=school.id,
        )
        _seed_user(
            db,
            personas=["student"],
            is_platform=False,
            env_username="SEED_STUDENT_USERNAME",
            env_password="SEED_STUDENT_PASSWORD",
            default_username="student1",
            default_display="学生",
            school_id=school.id,
        )

        # 测试学生（仅首次初始化）
        test_genders = ["男", "女", "男", "女", "男"]
        for i in range(2, 6):
            username = f"student{i}"
            if db.query(User).filter(User.username == username).first():
                continue
            user = User(
                username=username,
                password_hash=hash_password("123456"),
                display_name=f"学生{i}",
                student_id=f"202400{i:02d}",
                gender=test_genders[i - 1],
                school_id=school.id,
            )
            db.add(user)
            db.flush()
            db.add(UserSchoolPersona(user_id=user.id, school_id=school.id, persona="student"))
        db.commit()
        log.debug("测试学生已创建 (student1-5 / 123456)")

    finally:
        db.close()


def _apply_repository_case(row: Case, d: dict) -> None:
    """把仓库病例的元数据与内容写进行（元数据只进列，内容剥离元数据后进 case_data）。

    不动 ``is_open``：那是教师的「向学生开放」开关，内容更新不该替教师打开病例。
    """
    row.description = d.get("description", "")
    row.difficulty = d.get("difficulty", 1)
    row.time_limit_minutes = d.get("time_limit") or DEFAULT_TIME_LIMIT_MINUTES
    row.case_data = with_seed_bookmark(d)


def _sync_case_revision(db, row: Case) -> None:
    """内置病例的版本语义：内容即版本。

    内容与 current revision 一致时不产生新版本（元数据微调不需要新版本）；内容变了就
    追加 revision（与教师编辑已发布病例同一规则）。已归档病例内容冻结，不复活、不追加。
    """
    if row.status == CASE_STATUS_ARCHIVED:
        return
    row.status = CASE_STATUS_PUBLISHED
    if content_matches_current_revision(row):
        return
    append_revision(db, row)


def _seed_cases() -> None:
    """Import / refresh built-in cases from data/cases/*.json.

    Idempotent and converging: a row whose content still matches the revision it
    was seeded from (or that carries no seed fingerprint at all) is rewritten
    from the repository file, so content fixes in data/cases/*.json reach
    databases initialised from an older revision. Rows a teacher has edited are
    left untouched and logged.

    内置病例按「已发布」落库（部署即学生可用），并即时产生/推进 CaseRevision：仓库内容改动 = 一个新版本，旧训练按旧版本复盘。
    """
    cases_dir = _PROJECT_ROOT / "data" / "cases"
    entries: list[tuple[str, dict]] = []
    for fpath in sorted(cases_dir.glob("*.json")):
        try:
            d = json.loads(fpath.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as e:
            log.warning("病例文件读取失败 %s: %s", fpath.name, e)
            continue
        entries.append((d.get("name") or fpath.stem, d))
    if not entries:
        return

    db = SessionLocal()
    try:
        rows = {c.name: c for c in db.query(Case).filter(Case.name.in_([name for name, _ in entries])).all()}
        imported = updated = kept = 0
        for name, d in entries:
            row = rows.get(name)
            if row is None:
                row = Case(name=name, status=CASE_STATUS_PUBLISHED, is_open=True)
                _apply_repository_case(row, d)
                db.add(row)
                db.flush()
                _sync_case_revision(db, row)
                imported += 1
                continue
            existing = row.case_data or {}
            if is_locally_edited(existing) or row.status == CASE_STATUS_ARCHIVED:
                kept += 1
                log.warning("内置病例已被本地修改/归档，保留库内内容（case_id=%s name=%s）", row.id, name)
                continue
            # 未被教师改动的行以仓库文件为准：内容 + 元数据列 + 指纹都收敛
            # （元数据只存在列上，列不收敛就会出现「库内 time_limit=20、文件=30」的僵局）
            before = (row.description, row.difficulty, row.time_limit_minutes, dict(existing))
            _apply_repository_case(row, d)
            _sync_case_revision(db, row)
            if (row.description, row.difficulty, row.time_limit_minutes, dict(row.case_data)) != before:
                updated += 1
                log.warning("内置病例随版本收敛（case_id=%s name=%s）", row.id, name)
        if imported or updated:
            try:
                db.commit()
            except Exception as e:
                db.rollback()
                log.warning("病例种子写入失败（数据库 schema 不匹配？）: %s", e)
        log.debug("病例导入完成: 新增 %d, 更新 %d, 保留本地修改 %d", imported, updated, kept)
    finally:
        db.close()


def _seed_llm() -> None:
    db = SessionLocal()
    try:
        raw_key = DEEPSEEK_API_KEY

        # 清理重复密钥（同 label + suffix 只保留第一个）
        dupes = (
            db.query(ApiSecret)
            .filter(
                ApiSecret.label == "初始服务密钥",
                ApiSecret.api_key == raw_key,
            )
            .order_by(ApiSecret.id)
            .all()
        )
        if len(dupes) > 1:
            for d in dupes[1:]:
                db.delete(d)
            db.commit()
            log.debug("清理重复密钥: %d → %d", len(dupes), 1)

        matched = dupes[0] if dupes else None
        if matched:
            needs_sync = False
            if matched.api_key != raw_key:
                matched.api_key = raw_key
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
                api_key=raw_key,
                base_url=DEEPSEEK_BASE_URL,
                price_input_per_1m=1.0,
                price_output_per_1m=2.0,
            )
            db.add(secret)
            db.flush()
            log.debug("种子密钥已创建")

        db.commit()
        log.debug("LLM 种子完成: secret#%d", secret.id)
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
                    api_key="",
                    tts_resource_id="seed-tts-2.0",
                    tts_speaker="zh_female_vv_uranus_bigtts",
                    tts_model="seed-tts-2.0-standard",
                    tts_sample_rate=24000,
                    tts_format="mp3",
                    tts_timeout=8,
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
