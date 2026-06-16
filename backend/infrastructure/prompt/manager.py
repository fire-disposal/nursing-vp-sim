"""Prompt 模板管理器 —— 从 DB 加载模板，支持热切换和硬编码兜底"""

import asyncio
import logging
import re
import threading

from prompts import (
    CASE_GENERATION_SYSTEM,
    PATIENT_CHAT_SYSTEM,
    PATIENT_DYNAMIC_TEMPLATE,
    QA_SYSTEM,
    SCORING_FEEDBACK_SYSTEM,
    SCORING_FEEDBACK_USER,
    SCORING_SYSTEM,
    SCORING_USER,
)

log = logging.getLogger(__name__)

_VAR_RE = re.compile(r"\{#([^}#]+)#\}")


def render_template(template: str, **kwargs) -> str:
    def _replace(m: re.Match) -> str:
        var = m.group(1).strip()
        if var not in kwargs:
            raise RuntimeError(f"模板变量缺失: '{var}'")
        return str(kwargs[var])

    try:
        return _VAR_RE.sub(_replace, template)
    except RuntimeError:
        raise
    except Exception as e:
        raise RuntimeError(f"模板渲染异常: {e}")


class PromptTemplateObj:
    def __init__(
        self,
        id: int,
        purpose: str,
        version: int,
        system_prompt: str,
        user_prompt: str | None,
        variables: list[dict] | None = None,
    ):
        self.id = id
        self.purpose = purpose
        self.version = version
        self.system_prompt = system_prompt
        self.user_prompt = user_prompt
        self._var_defaults: dict[str, str] = {}
        if variables:
            for v in variables:
                name = v.get("name", "") if isinstance(v, dict) else str(v)
                default = v.get("default_value", "") if isinstance(v, dict) else ""
                if name and default:
                    self._var_defaults[name] = default

    def render(self, **kwargs) -> str:
        merged = {**self._var_defaults, **kwargs}
        if self._var_defaults:
            used_defaults = [k for k in self._var_defaults if k not in kwargs]
            if used_defaults:
                log.info(
                    "prompt render using default_value for %s: %s",
                    self.purpose,
                    used_defaults,
                )
        try:
            return render_template(self.system_prompt, **merged)
        except RuntimeError as e:
            import re as _re

            expected = sorted(set(_re.findall(r"\{#([^}#]+)#\}", self.system_prompt)))
            provided = sorted(kwargs.keys())
            missing = [v for v in expected if v not in kwargs]
            raise RuntimeError(
                f"{e} (purpose={self.purpose}, v{self.version}, "
                f"期望变量: {expected}, 实际传入: {provided}, 缺失: {missing})"
            )

    def render_pair(self, **kwargs) -> tuple[str, str]:
        merged = {**self._var_defaults, **kwargs}
        system = self.render(**merged)
        user = ""
        if self.user_prompt:
            try:
                user = render_template(self.user_prompt, **merged)
            except RuntimeError as e:
                raise RuntimeError(f"{e} in user_prompt (purpose={self.purpose}, v{self.version})")
        return system, user


class PromptManager:
    def __init__(self):
        self._cache: dict[str, PromptTemplateObj] = {}
        self._last_valid_cache: dict[str, PromptTemplateObj] | None = None
        self._lock = threading.Lock()
        self._load_lock = asyncio.Lock()

    async def load_from_db(self):
        from core.database import SessionLocal
        from models import PromptTemplate as PT

        db = SessionLocal()
        try:
            self._seed_all_builtin(db)
            self._sync_builtin_patient_chat(db)
            self._sync_builtin_patient_dynamic(db)
            self._sync_builtin_scoring_feedback(db)
            rows = db.query(PT).filter(PT.is_active).all()

            new_cache = {}
            for r in rows:
                new_cache[r.purpose] = PromptTemplateObj(
                    id=r.id,
                    purpose=r.purpose,
                    version=r.version,
                    system_prompt=r.system_prompt,
                    user_prompt=r.user_prompt,
                    variables=r.variables,
                )

            async with self._load_lock:
                self._last_valid_cache = dict(self._cache)
                self._cache = new_cache
            log.debug("PromptManager loaded: %d templates", len(new_cache))
        except Exception:
            log.exception("PromptManager load failed")
            if self._last_valid_cache:
                async with self._load_lock:
                    self._cache = self._last_valid_cache
                log.warning("retaining last valid cache")
            raise
        finally:
            db.close()

    async def get(self, purpose: str) -> PromptTemplateObj:
        with self._lock:
            tmpl = self._cache.get(purpose)
        if tmpl is not None:
            return tmpl
        try:
            await self.load_from_db()
        except Exception:
            log.warning("reload failed, using hardcoded fallback for purpose=%s", purpose)
        with self._lock:
            tmpl = self._cache.get(purpose)
        if tmpl is not None:
            return tmpl
        return _hardcoded_fallback(purpose)

    async def reload(self):
        await self.load_from_db()

    @staticmethod
    def _seed_all_builtin(db):
        """Ensure all built-in templates exist in DB (idempotent)."""
        from models import PromptTemplate as PT

        seeds = [
            ("patient_chat", PATIENT_CHAT_SYSTEM, None, "患者角色扮演 Character Card — 内置模板"),
            ("patient_dynamic", PATIENT_DYNAMIC_TEMPLATE, None, "病情动态数据块 — 内置模板"),
            ("qa", QA_SYSTEM, None, "通用护理问答 — 内置模板"),
            ("case_generation", CASE_GENERATION_SYSTEM, None, "病例生成 — 内置模板"),
        ]
        user_seeds = [
            ("scoring", SCORING_SYSTEM, SCORING_USER, "评分模板 — 内置模板"),
            ("scoring_feedback", SCORING_FEEDBACK_SYSTEM, SCORING_FEEDBACK_USER, "评分反馈 — 内置模板"),
        ]

        for purpose, sys_prompt, user_prompt, remark in seeds:
            existing = db.query(PT).filter(PT.purpose == purpose, PT.is_active).first()
            if not existing:
                db.add(
                    PT(
                        purpose=purpose,
                        version=1,
                        system_prompt=sys_prompt,
                        template_engine="variable",
                        is_active=True,
                        created_by="system",
                        remark=remark,
                    )
                )

        for purpose, sys_prompt, user_prompt, remark in user_seeds:
            existing = db.query(PT).filter(PT.purpose == purpose, PT.is_active).first()
            if not existing:
                db.add(
                    PT(
                        purpose=purpose,
                        version=1,
                        system_prompt=sys_prompt,
                        user_prompt=user_prompt,
                        template_engine="variable",
                        is_active=True,
                        created_by="system",
                        remark=remark,
                    )
                )

        db.commit()

    @staticmethod
    def _sync_builtin_patient_chat(db):
        """强制同步 patient_chat 内置模板到 DB，确保新变量格式可用。"""
        from models import PromptTemplate as PT
        from prompts.patient_chat import PATIENT_CHAT_SYSTEM

        existing = db.query(PT).filter(PT.purpose == "patient_chat", PT.is_active).all()
        if existing:
            needs_update = any("hidden_info_rules" in t.system_prompt for t in existing)
            if not needs_update:
                return
            for t in existing:
                t.is_active = False
                t.system_prompt = PATIENT_CHAT_SYSTEM
            db.commit()
            log.info(
                "patient_chat 模板已同步到 Character Card 格式 (v%d→v%d)", existing[0].version, existing[0].version + 1
            )

    @staticmethod
    def _sync_builtin_patient_dynamic(db):
        """确保 patient_dynamic 模板存在于 DB 中。"""
        from models import PromptTemplate as PT

        existing = db.query(PT).filter(PT.purpose == "patient_dynamic", PT.is_active).first()
        if existing:
            return
        db.add(
            PT(
                purpose="patient_dynamic",
                version=1,
                system_prompt=PATIENT_DYNAMIC_TEMPLATE,
                template_engine="format",
                is_active=True,
                created_by="system",
                remark="病情动态数据块 — 内置模板",
            )
        )
        db.commit()
        log.info("patient_dynamic 内置模板已创建")

    @staticmethod
    def _sync_builtin_scoring_feedback(db):
        """强制同步 scoring_feedback 内置模板到 DB，移除旧版已弃用的变量引用。"""
        from models import PromptTemplate as PT
        from prompts.scoring import SCORING_FEEDBACK_SYSTEM, SCORING_FEEDBACK_USER

        existing = db.query(PT).filter(PT.purpose == "scoring_feedback", PT.is_active).first()
        if not existing:
            return
        old_text = (existing.user_prompt or "") + (existing.system_prompt or "")
        if "{#scoring_result#}" not in old_text:
            return
        existing.is_active = False
        db.add(
            PT(
                purpose="scoring_feedback",
                version=existing.version + 1,
                system_prompt=SCORING_FEEDBACK_SYSTEM,
                user_prompt=SCORING_FEEDBACK_USER,
                template_engine="variable",
                is_active=True,
                created_by="system",
                remark="评分反馈 — 内置模板（已同步）",
            )
        )
        db.commit()
        log.info(
            "scoring_feedback 模板已同步 (v%d→v%d), 移除旧版 scoring_result 变量",
            existing.version,
            existing.version + 1,
        )


def _hardcoded_fallback(purpose: str) -> PromptTemplateObj:
    if purpose == "qa":
        return PromptTemplateObj(0, "qa", 0, QA_SYSTEM, None)
    if purpose == "patient_chat":
        return PromptTemplateObj(0, "patient_chat", 0, PATIENT_CHAT_SYSTEM, None)
    if purpose == "scoring":
        return PromptTemplateObj(0, "scoring", 0, SCORING_SYSTEM, SCORING_USER)
    if purpose == "patient_dynamic":
        return PromptTemplateObj(0, "patient_dynamic", 0, PATIENT_DYNAMIC_TEMPLATE, None)
    if purpose == "scoring_feedback":
        return PromptTemplateObj(0, "scoring_feedback", 0, SCORING_FEEDBACK_SYSTEM, SCORING_FEEDBACK_USER)
    if purpose == "case_generation":
        return PromptTemplateObj(0, "case_generation", 0, CASE_GENERATION_SYSTEM, None)
    raise ValueError(f"Unknown prompt purpose: {purpose}")
