from dataclasses import dataclass, field
from typing import Callable, Awaitable, Any

# PipelineMiddleware = async callable(ctx: PipelineContext, next_mw) -> None
PipelineMiddleware = Callable[..., Awaitable[Any]]


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
    on_end: Callable | None = None
    on_score: Callable | None = None


# ── 插件注册表 ──
_registry: dict[str, PipelinePlugin] = {}


def register_plugin(plugin: PipelinePlugin) -> None:
    _registry[plugin.id] = plugin


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
            if not all(_registry.get(dep_id) for dep_id in plugin.requires):
                continue
        active.append(plugin)
    return active
