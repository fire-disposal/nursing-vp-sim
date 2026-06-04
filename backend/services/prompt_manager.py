"""Prompt 模板管理器 —— 从 DB 加载模板，支持热切换和硬编码兜底"""

import asyncio
import logging
import re

from prompts import CASE_GENERATION_SYSTEM, PATIENT_CHAT_SYSTEM, QA_SYSTEM, SCORING_SYSTEM, SCORING_USER

_logger = logging.getLogger(__name__)

_VAR_RE = re.compile(r"\{#([^}#]+)#\}")


def render_template(template: str, **kwargs) -> str:
    """安全模板渲染 —— 用 {#variable#} 语法替换变量。

    与 Python format() 不同：花括号 {} 在值中原样保留，不会被误解析。
    仅替换 {#name#} 模式，缺失变量抛 RuntimeError。
    设计原因：Prompt 模板可能包含 JSON 示例（带 {}），format() 会误伤。
    """

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
    """单个 prompt 模板实例，支持变量渲染"""

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
                _logger.info(
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
        system = self.render(**kwargs)
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
        self._lock = asyncio.Lock()

    async def load_from_db(self):
        from database import SessionLocal
        from models import PromptTemplate as PT

        db = SessionLocal()
        try:
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

            async with self._lock:
                self._last_valid_cache = self._cache
                self._cache = new_cache
            _logger.info("PromptManager 加载: %d 个模板", len(new_cache))
        except Exception:
            _logger.exception("PromptManager 加载失败")
            if self._last_valid_cache:
                async with self._lock:
                    self._cache = self._last_valid_cache
                _logger.warning("保留上次有效缓存")
            raise
        finally:
            db.close()

    async def get(self, purpose: str) -> PromptTemplateObj:
        """获取激活模板。三层降级保障：
        1. 内存缓存命中 → 直接返回（最快）
        2. 缓存未命中 → 从 DB 重新加载
        3. DB 加载失败 → 使用上次有效缓存
        4. 最终兜底 → 硬编码模板（永不返回 None）
        """
        async with self._lock:
            tmpl = self._cache.get(purpose)
        if tmpl is not None:
            return tmpl
        try:
            await self.load_from_db()
        except Exception:
            _logger.warning("reload 失败，使用硬编码兜底 for purpose=%s", purpose)
        async with self._lock:
            tmpl = self._cache.get(purpose)
        if tmpl is not None:
            return tmpl
        return _hardcoded_fallback(purpose)

    async def reload(self):
        await self.load_from_db()


# ── 全局单例 ──

_manager: PromptManager | None = None
_manager_lock = asyncio.Lock()


async def get_prompt_manager() -> PromptManager:
    global _manager
    if _manager is not None:
        return _manager
    async with _manager_lock:
        if _manager is None:
            _manager = PromptManager()
            await _manager.load_from_db()
    return _manager


async def refresh_prompts():
    global _manager
    if _manager is None:
        _manager = PromptManager()
    await _manager.load_from_db()
