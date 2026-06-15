"""PluginManager — plugin lifecycle, pipeline assembly, and manifest generation."""

from __future__ import annotations

import asyncio
import logging
from typing import TYPE_CHECKING, Any

from .base import (
    PipelineStage,
    stage_order,
)

if TYPE_CHECKING:
    from .base import Plugin

log = logging.getLogger(__name__)

CORE_MIDDLEWARE: dict[PipelineStage, list[Any]] = {}

# Reusable event loop for run_hook_sync — avoids asyncio.run() overhead
_shared_hook_loop: asyncio.AbstractEventLoop | None = None


class PluginManager:
    def __init__(self):
        self._plugins: dict[str, Plugin] = {}
        self._initialized = False

    def register(self, plugin: Plugin) -> None:
        if plugin.id in self._plugins:
            log.warning("Plugin %s already registered, overwriting", plugin.id)
        self._plugins[plugin.id] = plugin
        log.info("Plugin registered: %s", plugin.id)

    def discover(self) -> None:
        if self._initialized:
            return
        self._initialized = True
        for cls in _all_plugin_classes():
            try:
                instance = cls()
                self.register(instance)
            except Exception:
                log.exception("Failed to instantiate plugin class %s", cls.__name__)

    def get_active(self, feature_flags: dict[str, bool] | None = None) -> list[Plugin]:
        flags = feature_flags or {}
        active: list[Plugin] = []
        for plugin in self._plugins.values():
            if not self._is_active(plugin, flags):
                continue
            active.append(plugin)
        return active

    def _is_active(self, plugin: Plugin, flags: dict[str, bool]) -> bool:
        ff = plugin.feature_flag
        if ff is not None:
            flag_key = ff.key
            if not flags.get(flag_key, ff.default):
                return False
        for dep_id in plugin.requires:
            dep = self._plugins.get(dep_id)
            if dep is None:
                return False
            if not self._is_active(dep, flags):
                return False
        return True

    def build_pipeline(self, feature_flags: dict[str, bool] | None = None) -> list[Any]:
        if not CORE_MIDDLEWARE:
            from contexts.training.pipeline.middleware import (
                llm_caller,
                persister,
                phase_guard,
                phase_transition,
                prompt_builder,
                side_effects,
            )

            CORE_MIDDLEWARE[PipelineStage.GUARD] = [phase_guard]
            CORE_MIDDLEWARE[PipelineStage.TRANSITION] = [phase_transition]
            CORE_MIDDLEWARE[PipelineStage.PROMPT] = [prompt_builder]
            CORE_MIDDLEWARE[PipelineStage.LLM] = [llm_caller]
            CORE_MIDDLEWARE[PipelineStage.PERSIST] = [persister]
            CORE_MIDDLEWARE[PipelineStage.SIDE_EFFECTS] = [side_effects]
            CORE_MIDDLEWARE[PipelineStage.PLUGIN_EARLY] = []

        flags = feature_flags or {}
        stage_buckets: dict[PipelineStage, list[Any]] = {s: list(CORE_MIDDLEWARE.get(s, [])) for s in PipelineStage}

        for plugin in self.get_active(flags):
            for stage, mw in plugin.get_middleware():
                stage_buckets.setdefault(stage, []).append(mw)

        result: list[Any] = []
        for stage in sorted(PipelineStage, key=stage_order):
            result.extend(stage_buckets.get(stage, []))
        return result

    async def run_hook(
        self,
        hook_name: str,
        ctx: Any,
        feature_flags: dict[str, bool] | None = None,
    ) -> list[Any]:
        results: list[Any] = []
        for plugin in self.get_active(feature_flags):
            hook = getattr(plugin, hook_name, None)
            if hook is None:
                continue
            try:
                result = await hook(ctx) if asyncio.iscoroutinefunction(hook) else hook(ctx)
                results.append(result)
            except Exception:
                log.exception("Plugin %s hook %s failed", plugin.id, hook_name)
        return results

    def run_hook_sync(
        self,
        hook_name: str,
        ctx: Any,
        feature_flags: dict[str, bool] | None = None,
    ) -> list[Any]:
        global _shared_hook_loop
        results: list[Any] = []
        for plugin in self.get_active(feature_flags):
            hook = getattr(plugin, hook_name, None)
            if hook is None:
                continue
            try:
                if asyncio.iscoroutinefunction(hook):
                    if _shared_hook_loop is None or _shared_hook_loop.is_closed():
                        _shared_hook_loop = asyncio.new_event_loop()
                    result = _shared_hook_loop.run_until_complete(hook(ctx))
                else:
                    result = hook(ctx)
                results.append(result)
            except Exception:
                log.exception("Plugin %s hook %s failed", plugin.id, hook_name)
        return results

    def generate_manifest(self, feature_flags: dict[str, bool] | None = None) -> dict:
        plugins_data: list[dict] = []
        for plugin in self.get_active(feature_flags):
            entry: dict[str, Any] = {
                "id": plugin.id,
                "name": plugin.name,
                "description": plugin.description,
                "requires": list(plugin.requires),
            }
            if plugin.feature_flag is not None:
                entry["feature_flag"] = plugin.feature_flag.key
            ui = plugin.ui_manifest()
            if ui is not None:
                entry["ui"] = {
                    "type": ui.type,
                    "tab": ui.tab,
                    "actions": ui.actions,
                }
            plugins_data.append(entry)

        feature_flags_data: dict = {}
        for plugin in self._plugins.values():
            ff = plugin.feature_flag
            if ff is not None:
                feature_flags_data[ff.key] = {
                    "key": ff.key,
                    "label": ff.label,
                    "default": ff.default,
                    "description": ff.description,
                }

        return {"plugins": plugins_data, "feature_flags": feature_flags_data}

    def register_routes(self, router: Any) -> None:

        for plugin in self._plugins.values():
            for rd in plugin.get_routes():
                router.add_api_route(
                    path=rd.path,
                    endpoint=rd.handler,
                    methods=[rd.method],
                    response_model=rd.response_model,
                    tags=rd.tags,
                )


def _all_plugin_classes() -> list[type]:
    import importlib
    from pathlib import Path

    from .base import Plugin

    plugin_dir = Path(__file__).parent
    classes: list[type] = []

    for entry in sorted(plugin_dir.iterdir()):
        if not entry.is_dir():
            continue
        if entry.name.startswith("_") or entry.name.startswith("."):
            continue
        plugin_module_path = f"plugins.{entry.name}.plugin"
        try:
            mod = importlib.import_module(plugin_module_path)
            for attr_name in dir(mod):
                attr = getattr(mod, attr_name)
                if isinstance(attr, type) and issubclass(attr, Plugin) and attr is not Plugin:
                    classes.append(attr)
        except ImportError:
            log.debug("No plugin module: %s", plugin_module_path)

    return classes


_plugin_manager: PluginManager | None = None


def get_plugin_manager() -> PluginManager:
    global _plugin_manager
    if _plugin_manager is None:
        _plugin_manager = PluginManager()
    return _plugin_manager
