import logging
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any

PipelineMiddleware = Callable[..., Awaitable[Any]]

log = logging.getLogger(__name__)


@dataclass
class PipelinePluginMeta:
    description: str = ""
    author: str = ""
    version: str = "1.0.0"
    tags: list[str] = field(default_factory=list)


@dataclass
class PipelinePlugin:
    id: str
    name: str
    feature_flag: str | None = None
    requires: list[str] = field(default_factory=list)
    meta: PipelinePluginMeta = field(default_factory=PipelinePluginMeta)

    middleware: list[PipelineMiddleware] = field(default_factory=list)
    on_record_create: Callable | None = None
    on_phase_change: Callable | None = None
    on_exam: Callable | None = None
    on_end: Callable | None = None
    on_score: Callable | None = None


_registry: dict[str, PipelinePlugin] = {}


def register_plugin(plugin: PipelinePlugin) -> None:
    if plugin.id in _registry:
        log.warning("Plugin %s already registered, overwriting", plugin.id)
    _registry[plugin.id] = plugin


def unregister_plugin(plugin_id: str) -> bool:
    return _registry.pop(plugin_id, None) is not None


def get_plugin(plugin_id: str) -> PipelinePlugin | None:
    return _registry.get(plugin_id)


def get_all_plugins() -> list[PipelinePlugin]:
    return list(_registry.values())


def get_active_plugins(feature_flags: dict[str, bool]) -> list[PipelinePlugin]:
    active = []
    for plugin in _registry.values():
        if plugin.feature_flag and not feature_flags.get(plugin.feature_flag, False):
            continue
        if plugin.requires:
            if not all(_is_dep_active(dep_id, feature_flags) for dep_id in plugin.requires):
                continue
        active.append(plugin)
    return active


def _is_dep_active(dep_id: str, feature_flags: dict[str, bool]) -> bool:
    dep = _registry.get(dep_id)
    if dep is None:
        return False
    if dep.feature_flag and not feature_flags.get(dep.feature_flag, False):
        return False
    return True


def run_plugin_hooks(hook_name: str, ctx, feature_flags: dict[str, bool] | None = None) -> None:
    """Invoke a named hook on all active plugins.  Passes ctx which should be
    a TrainingRecord for on_record_create/on_end hooks, or PipelineContext for pipeline hooks.
    """
    flags = feature_flags or {}
    for plugin in get_active_plugins(flags):
        hook = getattr(plugin, hook_name, None)
        if hook is not None:
            try:
                hook(ctx)
            except Exception:
                log.exception("Plugin %s hook %s failed", plugin.id, hook_name)
