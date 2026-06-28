"""Prompt template business logic."""

import logging
import re
from datetime import UTC, datetime

from sqlalchemy.orm import Session

from core.exceptions import NotFoundError, ValidationError
from core.unit_of_work import unit_of_work
from infrastructure.prompt import get_registry, render_template
from models import PromptTemplate as PT
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
from repositories.base import Repository

log = logging.getLogger(__name__)

BUILTIN_MAP: dict[str, tuple[str, str | None, str]] = {
    "patient_chat": (PATIENT_CHAT_SYSTEM, None, "虚拟患者对话 — 内置兜底"),
    "patient_dynamic": (PATIENT_DYNAMIC_TEMPLATE, None, "病情动态数据块 — 内置兜底"),
    "scoring": (SCORING_SYSTEM, SCORING_USER, "训练评分 — 内置兜底"),
    "scoring_feedback": (SCORING_FEEDBACK_SYSTEM, SCORING_FEEDBACK_USER, "评分反馈生成 — 内置兜底"),
    "qa": (QA_SYSTEM, None, "护理学问答 — 内置兜底"),
    "case_generation": (CASE_GENERATION_SYSTEM, None, "病例生成 — 内置兜底"),
}


class PromptTemplateRepository(Repository[PT]):
    model = PT


def extract_vars(text: str | None) -> set[str]:
    if not text:
        return set()
    return set(re.findall(r"\{#([^}#]+)#\}", text))


def dedup_variables(variables: list[dict]) -> list[dict]:
    seen: set[str] = set()
    result: list[dict] = []
    for v in variables:
        name = v.get("name", "") if isinstance(v, dict) else str(v)
        if name not in seen:
            seen.add(name)
            result.append(v if isinstance(v, dict) else {"name": name, "desc": ""})
    return result


def build_builtin_entries(purpose_filter: str | None, db_prompts: list[PT]) -> list[dict]:
    builtin_registry = get_registry()
    now = datetime.now(UTC)
    results: list[dict] = []

    for p, (system, user, label) in BUILTIN_MAP.items():
        if purpose_filter and p != purpose_filter:
            continue

        has_active_db = any(t.purpose == p and t.is_active for t in db_prompts)
        var_meta = builtin_registry.get_variables_jsonb(p)
        results.append(
            {
                "id": 0,
                "purpose": p,
                "version": 0,
                "name": f"内置版本 — {label}",
                "system_prompt": system,
                "user_prompt": user,
                "template_engine": "hardcoded",
                "variables": var_meta,
                "is_active": not has_active_db,
                "created_by": "system",
                "remark": "系统内置兜底提示词，不在数据库中。无 DB 激活版本时自动使用。",
                "created_at": now,
                "updated_at": now,
                "is_builtin": True,
                "locked": True,
            }
        )

    return results


class PromptTemplateService:
    def __init__(self, db: Session):
        self.db = db
        self.repo = PromptTemplateRepository(db)

    def list(self, purpose: str | None = None) -> list[dict]:
        q = self.db.query(PT).order_by(PT.purpose, PT.version.desc())
        if purpose:
            q = q.filter(PT.purpose == purpose)
        db_prompts = list(q.all())
        builtins = build_builtin_entries(purpose, db_prompts)
        return db_prompts + builtins

    def create(self, data: dict, username: str, activate: bool = False) -> PT:
        max_v = self.db.query(PT).filter(PT.purpose == data["purpose"]).order_by(PT.version.desc()).first()
        version = (max_v.version + 1) if max_v else 1

        template_vars = extract_vars(data.get("system_prompt")) | extract_vars(data.get("user_prompt"))
        errors, warnings = get_registry().validate_template_vars(data["purpose"], template_vars)
        if errors:
            raise ValidationError("; ".join(errors))
        if warnings:
            log.warning("create_prompt %s: %s", data["purpose"], "; ".join(warnings))

        variables = data.get("variables")
        if variables:
            registry_map = get_registry().get_variable_map(data["purpose"])
            merged = []
            for uv in variables:
                name = uv["name"] if isinstance(uv, dict) else uv
                if isinstance(uv, dict) and name in registry_map:
                    rv = registry_map[name]
                    merged.append(
                        {
                            "name": name,
                            "desc": uv.get("desc", rv.description),
                            "source": uv.get("source", rv.source),
                            "type": uv.get("type", rv.type),
                            "example": uv.get("example", rv.default_example),
                        }
                    )
                elif isinstance(uv, dict):
                    merged.append(uv)
                else:
                    merged.append({"name": name, "desc": ""})
            default_vars = merged
        else:
            default_vars = get_registry().get_variables_jsonb(data["purpose"])

        pt = PT(
            purpose=data["purpose"],
            version=version,
            name=data["name"],
            system_prompt=data.get("system_prompt", ""),
            user_prompt=data.get("user_prompt"),
            variables=dedup_variables(default_vars),
            is_active=False,
            created_by=data.get("created_by") or username,
            remark=data.get("remark"),
        )
        with unit_of_work(self.db, conflict_detail="创建提示词模板失败"):
            self.repo.add(pt)
        self.db.refresh(pt)
        return pt

    def update(self, prompt_id: int, data: dict) -> PT:
        pt = self.repo.get(prompt_id)
        if not pt:
            raise NotFoundError("模板不存在")
        with unit_of_work(self.db, conflict_detail="更新提示词模板失败"):
            for k, v in data.items():
                if v is not None:
                    setattr(pt, k, v)
            if any(k in data for k in ("system_prompt", "user_prompt")):
                template_vars = extract_vars(pt.system_prompt) | extract_vars(pt.user_prompt)
                errors, warnings = get_registry().validate_template_vars(pt.purpose, template_vars)
                if errors:
                    raise ValidationError("; ".join(errors))
                if warnings:
                    log.warning("update_prompt %s v%d: %s", pt.purpose, pt.version, "; ".join(warnings))
                existing_map = {v["name"]: v for v in (pt.variables or [])}
                registry_map = get_registry().get_variable_map(pt.purpose)
                new_vars = []
                for vname in sorted(template_vars):
                    if vname in existing_map:
                        new_vars.append(existing_map[vname])
                    elif vname in registry_map:
                        rv = registry_map[vname]
                        new_vars.append(
                            {
                                "name": vname,
                                "desc": rv.description,
                                "source": rv.source,
                                "type": rv.type,
                                "example": rv.default_example,
                            }
                        )
                    else:
                        new_vars.append({"name": vname, "desc": ""})
                pt.variables = dedup_variables(new_vars)
        self.db.refresh(pt)
        return pt

    def delete(self, prompt_id: int) -> None:
        pt = self.repo.get(prompt_id)
        if not pt:
            raise NotFoundError("模板不存在")
        if pt.is_active:
            raise ValidationError("不能删除当前激活的模板，请先激活其他版本")
        with unit_of_work(self.db, conflict_detail="删除提示词模板失败"):
            self.repo.delete(pt)

    def activate(self, prompt_id: int, purpose: str | None = None) -> None:
        if prompt_id == 0:
            if not purpose:
                raise ValidationError("切换到内置版本需要指定 purpose")
            with unit_of_work(self.db, conflict_detail="激活模板失败"):
                self.db.query(PT).filter(PT.purpose == purpose).update({"is_active": False})
            return

        pt = self.repo.get(prompt_id)
        if not pt:
            raise NotFoundError("模板不存在")
        with unit_of_work(self.db, conflict_detail="激活模板失败"):
            self.db.query(PT).filter(PT.purpose == pt.purpose).update({"is_active": False})
            pt.is_active = True

    @staticmethod
    def validate(data: dict) -> dict:
        errors = []
        system_prompt = data.get("system_prompt", "")
        user_prompt = data.get("user_prompt")
        variables = data.get("variables", [])
        purpose = data.get("purpose", "")

        vars_set = extract_vars(system_prompt) | extract_vars(user_prompt)
        dummy = {v: f"<{v}>" for v in vars_set}
        try:
            render_template(system_prompt, **dummy)
        except RuntimeError as e:
            errors.append(f"system_prompt 引用未声明的变量: {e}")
        except Exception as e:
            errors.append(f"system_prompt 语法错误: {e}")

        if user_prompt:
            try:
                render_template(user_prompt, **dummy)
            except RuntimeError as e:
                errors.append(f"user_prompt 引用未声明的变量: {e}")
            except Exception as e:
                errors.append(f"user_prompt 语法错误: {e}")

        declared = {v["name"] for v in variables if isinstance(v, dict)}
        used = extract_vars(system_prompt) | extract_vars(user_prompt)
        missing = list(used - declared)

        reg_errors, reg_warnings = get_registry().validate_template_vars(purpose, vars_set)

        return {
            "valid": len(errors) == 0 and len(reg_errors) == 0,
            "errors": errors + reg_errors,
            "missing_vars": missing,
            "warnings": list(reg_warnings),
        }

    @staticmethod
    def get_sample_vars(purpose: str) -> dict:
        known = BUILTIN_MAP.keys()
        if purpose not in known:
            raise ValidationError(f"未知 purpose: {purpose}")
        return {"purpose": purpose, "vars": get_registry().get_sample_kwargs(purpose)}

    def preview_active(self, purpose: str) -> dict:
        pt = self.db.query(PT).filter(PT.purpose == purpose, PT.is_active).first()
        if not pt:
            raise NotFoundError(f"「{purpose}」没有激活的模板")
        sample = get_registry().get_sample_kwargs(purpose)
        for v in pt.variables or []:
            name = v.get("name", "") if isinstance(v, dict) else str(v)
            if name and name not in sample:
                default_val = v.get("default_value", "") if isinstance(v, dict) else ""
                sample[name] = default_val or (v.get("example", "") if isinstance(v, dict) else "")
        system_rendered = pt.system_prompt
        user_rendered = pt.user_prompt
        render_error = None
        try:
            system_rendered = render_template(pt.system_prompt, **sample) if sample else pt.system_prompt
            if pt.user_prompt:
                user_rendered = render_template(pt.user_prompt, **sample) if sample else pt.user_prompt
        except RuntimeError as e:
            render_error = str(e)
            log.warning("preview render failed purpose=%s v%d: %s", purpose, pt.version, e)
        return {
            "purpose": pt.purpose,
            "version": pt.version,
            "system_prompt_raw": pt.system_prompt,
            "user_prompt_raw": pt.user_prompt,
            "system_prompt_rendered": system_rendered,
            "user_prompt_rendered": user_rendered if pt.user_prompt else None,
            "sample_vars": sample,
            "render_error": render_error,
        }
