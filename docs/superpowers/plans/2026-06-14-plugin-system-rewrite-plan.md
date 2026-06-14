# Plugin System Rewrite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite the plugin system with a declarative `Plugin` ABC on the backend, a `GET /api/plugins/manifest` endpoint driving frontend rendering, and vite glob auto-discovery replacing manual plugin imports.

**Architecture:** Backend `Plugin` subclasses in `backend/plugins/<name>/` declare middleware/lifecycle/routes/ui capability via method overrides. `PluginManager` handles discovery, pipeline assembly, hook dispatch. Frontend fetches manifest, matches against `import.meta.glob` discovered components, and renders PanelHost automatically. No manual plugin arrays in page components.

**Tech Stack:** Python 3.11+ (async/await, ABC, dataclasses, Enum), FastAPI, React 18, TypeScript, vitest, pytest

---

## File Map

```
Create:
  backend/plugins/__init__.py
  backend/plugins/base.py              # Plugin ABC, PipelineStage, RouteDef, context types
  backend/plugins/manager.py           # PluginManager class
  backend/plugins/manifest.py          # ManifestResponse model + /api/plugins/manifest endpoint
  backend/plugins/emotion/__init__.py
  backend/plugins/emotion/plugin.py    # EmotionPlugin
  backend/plugins/emotion/middleware.py # emotion_tracker (moved, unchanged logic)
  backend/plugins/initiative/__init__.py
  backend/plugins/initiative/plugin.py # InitiativePlugin
  backend/plugins/physical-exam/__init__.py
  backend/plugins/physical-exam/plugin.py  # PhysicalExamPlugin
  backend/plugins/physical-exam/routes.py  # perform_exam handler
  backend/plugins/exam-emotion-bridge/__init__.py
  backend/plugins/exam-emotion-bridge/plugin.py  # ExamEmotionBridgePlugin
  backend/tests/test_plugin_system.py

Modify:
  backend/core/feature_flags.py        # Remove plugin flags, keep only allow_pause
  backend/main.py                      # Replace register_all_plugins with PluginManager.discover
  backend/contexts/training/pipeline/registry.py   # Use PluginManager.build_pipeline
  backend/contexts/training/router/chat.py          # Use PluginManager instead of get_pipeline
  backend/contexts/training/router/session.py       # Use PluginManager.run_hook("on_record_create")
  backend/contexts/training/router/progress.py      # Use PluginManager.run_hook("on_exam")
  backend/contexts/training/router/scoring.py       # Use PluginManager.run_hook("on_end")
  backend/contexts/training/pipeline/__init__.py    # Remove run_plugin_hooks, keep runner exports

  frontend/src/engine/types.ts                      # Add FrontendPlugin, ManifestPlugin, ManifestResponse types
  frontend/src/engine/PluginRegistry.ts              # Support manifest-driven registration
  frontend/src/engine/MessageBus.ts                  # TypedMessageBus
  frontend/src/engine/TrainingEngine.tsx             # Manifest-driven plugin rendering
  frontend/src/pages/ChatTraining.tsx                # Simplify to no manual imports
  frontend/src/pages/AdminDebugPage.tsx             # Simplify to no manual imports

  frontend/src/plugins/emotion/index.ts              # definePlugin export
  frontend/src/plugins/initiative/index.ts           # definePlugin export
  frontend/src/plugins/physical-exam/index.ts        # definePlugin export
  frontend/src/plugins/patient-info/index.ts         # definePlugin export
  frontend/src/plugins/inquiry/index.ts              # definePlugin export
  frontend/src/plugins/nursing-record/index.ts       # definePlugin export
  frontend/src/plugins/portrait/index.ts             # definePlugin export
  frontend/src/plugins/questionnaire/index.ts        # definePlugin export
  frontend/src/plugins/scoring-display/index.ts      # definePlugin export

Create:
  frontend/src/engine/discovery.ts                   # import.meta.glob auto-discovery
  frontend/src/engine/manifest.ts                    # fetchManifest + useManifest
  frontend/src/components/training/PluginErrorBoundary.tsx  # Error boundary per plugin tab
  frontend/src/engine/__tests__/PluginRegistry.test.ts
  frontend/src/engine/__tests__/MessageBus.test.ts

Delete or replace content:
  backend/contexts/training/pipeline/plugin.py      # Remove old Plugin dataclass + _registry
  backend/contexts/training/plugins.py              # Remove old plugin instances + register_all_plugins
```

---

### Task 1: Create `backend/plugins/base.py` — Plugin ABC, PipelineStage, RouteDef, context types

**Files:**
- Create: `backend/plugins/__init__.py`
- Create: `backend/plugins/base.py`

- [ ] **Step 1: Create `backend/plugins/__init__.py`**

```python
"""Plugin system — declarative protocol for training functionality."""

from .base import (
    EndContext,
    ExamContext,
    ExamEffect,
    PhaseChangeContext,
    PipelineStage,
    Plugin,
    RecordCreateContext,
    RouteDef,
    ScoreContext,
)

__all__ = [
    "EndContext",
    "ExamContext",
    "ExamEffect",
    "PhaseChangeContext",
    "PipelineStage",
    "Plugin",
    "RecordCreateContext",
    "RouteDef",
    "ScoreContext",
]
```

- [ ] **Step 2: Create `backend/plugins/base.py`**

```python
"""Plugin base class and supporting types."""

from __future__ import annotations

from abc import ABC
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from enum import Enum
from typing import TYPE_CHECKING, Any, ClassVar

if TYPE_CHECKING:
    from core.feature_flags import FeatureFlag
    from core.config import EmotionCache, InitiativeCache
    from models import TrainingRecord

PipelineMiddleware = Callable[
    ["PipelineContext", Callable[[], Awaitable[None]]],
    Awaitable[None],
]


class PipelineStage(str, Enum):
    GUARD = "guard"
    PLUGIN_EARLY = "plugin_early"
    TRANSITION = "transition"
    PROMPT = "prompt"
    LLM = "llm"
    PERSIST = "persist"
    SIDE_EFFECTS = "side_effects"


_STAGE_ORDER: dict[PipelineStage, int] = {
    PipelineStage.GUARD: 0,
    PipelineStage.PLUGIN_EARLY: 100,
    PipelineStage.TRANSITION: 200,
    PipelineStage.PROMPT: 300,
    PipelineStage.LLM: 400,
    PipelineStage.PERSIST: 500,
    PipelineStage.SIDE_EFFECTS: 600,
}


def stage_order(stage: PipelineStage) -> int:
    return _STAGE_ORDER[stage]


@dataclass
class RouteDef:
    method: str
    path: str
    handler: Callable
    response_model: type | None = None
    tags: list[str] = field(default_factory=lambda: ["plugin"])


@dataclass
class RecordCreateContext:
    record: Any  # TrainingRecord
    emotion_cache: Any  # EmotionCache
    initiative_cache: Any  # InitiativeCache


@dataclass
class ExamContext:
    record: Any  # TrainingRecord
    emotion_cache: Any  # EmotionCache
    op_type: str
    explanation_given: bool
    exam_count: int


@dataclass
class ExamEffect:
    snapshot_updates: dict = field(default_factory=dict)
    emotion_delta: tuple[int, int] | None = None
    history_event: dict | None = None


@dataclass
class EndContext:
    record: Any  # TrainingRecord
    emotion_cache: Any  # EmotionCache
    initiative_cache: Any  # InitiativeCache


@dataclass
class PhaseChangeContext:
    record: Any  # TrainingRecord
    from_phase: str
    to_phase: str


@dataclass
class ScoreContext:
    record: Any  # TrainingRecord
    score_data: dict = field(default_factory=dict)


@dataclass
class UIManifest:
    type: str  # "panel" | "overlay"
    tab: dict | None = None
    actions: list[dict] = field(default_factory=list)


class Plugin(ABC):
    id: ClassVar[str]
    name: ClassVar[str]
    description: ClassVar[str] = ""
    requires: ClassVar[list[str]] = []
    feature_flag: ClassVar[Any] = None  # FeatureFlag | None

    def get_middleware(self) -> list[tuple[PipelineStage, PipelineMiddleware]]:
        return []

    def get_routes(self) -> list[RouteDef]:
        return []

    async def on_record_create(self, ctx: RecordCreateContext) -> None:
        pass

    async def on_exam(self, ctx: ExamContext) -> ExamEffect | None:
        return None

    async def on_training_end(self, ctx: EndContext) -> None:
        pass

    async def on_phase_change(self, ctx: PhaseChangeContext) -> None:
        pass

    async def on_score(self, ctx: ScoreContext) -> None:
        pass

    def ui_manifest(self) -> UIManifest | None:
        return None

    def author_note(self, ctx: Any) -> str | None:
        return None
```

- [ ] **Step 3: Verify file imports correctly**

```bash
cd backend && python -c "from plugins import Plugin, PipelineStage, RouteDef; print('OK')"
```

Expected: `OK`

- [ ] **Step 4: Commit**

```bash
git add backend/plugins/__init__.py backend/plugins/base.py
git commit -m "✨ feat: add Plugin ABC, PipelineStage, RouteDef and context types"
```

---

### Task 2: Create `backend/plugins/manager.py` — PluginManager

**Files:**
- Create: `backend/plugins/manager.py`

- [ ] **Step 1: Write PluginManager**

```python
"""PluginManager — plugin lifecycle, pipeline assembly, and manifest generation."""

from __future__ import annotations

import asyncio
import logging
from typing import TYPE_CHECKING, Any

from .base import (
    EndContext,
    ExamContext,
    ExamEffect,
    PhaseChangeContext,
    PipelineStage,
    RecordCreateContext,
    ScoreContext,
    UIManifest,
    stage_order,
)

if TYPE_CHECKING:
    from .base import Plugin, PipelineMiddleware

log = logging.getLogger(__name__)

CORE_MIDDLEWARE: dict[PipelineStage, list["PipelineMiddleware"]] = {}


class PluginManager:
    def __init__(self):
        self._plugins: dict[str, "Plugin"] = {}
        self._initialized = False

    def register(self, plugin: "Plugin") -> None:
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

    def get_active(
        self, feature_flags: dict[str, bool] | None = None
    ) -> list["Plugin"]:
        flags = feature_flags or {}
        active: list["Plugin"] = []
        for plugin in self._plugins.values():
            if not self._is_active(plugin, flags):
                continue
            active.append(plugin)
        return active

    def _is_active(
        self, plugin: "Plugin", flags: dict[str, bool]
    ) -> bool:
        if plugin.feature_flag is not None:
            flag_key = plugin.feature_flag.key
            if not flags.get(flag_key, plugin.feature_flag.default):
                return False
        for dep_id in plugin.requires:
            dep = self._plugins.get(dep_id)
            if dep is None:
                return False
            if not self._is_active(dep, flags):
                return False
        return True

    def build_pipeline(
        self, feature_flags: dict[str, bool] | None = None
    ) -> list["PipelineMiddleware"]:
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
        stage_buckets: dict[PipelineStage, list["PipelineMiddleware"]] = {
            s: list(CORE_MIDDLEWARE.get(s, [])) for s in PipelineStage
        }

        for plugin in self.get_active(flags):
            for stage, mw in plugin.get_middleware():
                stage_buckets.setdefault(stage, []).append(mw)

        result: list["PipelineMiddleware"] = []
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
                if asyncio.iscoroutinefunction(hook):
                    result = await hook(ctx)
                else:
                    result = hook(ctx)
                results.append(result)
            except Exception:
                log.exception("Plugin %s hook %s failed", plugin.id, hook_name)
        return results

    def generate_manifest(
        self, feature_flags: dict[str, bool] | None = None
    ) -> dict:
        plugins_data: list[dict] = []
        for plugin in self.get_active(feature_flags):
            entry = {
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
        from fastapi import APIRouter

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
    import pkgutil
    from pathlib import Path

    from .base import Plugin

    plugin_dir = Path(__file__).parent
    classes: list[type] = []

    for entry in plugin_dir.iterdir():
        if not entry.is_dir():
            continue
        if entry.name.startswith("_") or entry.name.startswith("."):
            continue
        plugin_module_path = f"plugins.{entry.name}.plugin"
        try:
            mod = importlib.import_module(plugin_module_path)
            for attr_name in dir(mod):
                attr = getattr(mod, attr_name)
                if (
                    isinstance(attr, type)
                    and issubclass(attr, Plugin)
                    and attr is not Plugin
                ):
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
```

- [ ] **Step 2: Verify import**

```bash
cd backend && python -c "from plugins.manager import get_plugin_manager; print('OK')"
```

Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add backend/plugins/manager.py
git commit -m "✨ feat: add PluginManager with discovery, pipeline assembly, and manifest generation"
```

---

### Task 3: Create `backend/plugins/manifest.py` — Manifest endpoint

**Files:**
- Create: `backend/plugins/manifest.py`

- [ ] **Step 1: Write manifest endpoint module**

```python
"""GET /api/plugins/manifest — expose plugin UI metadata to frontend."""

import logging
from typing import Annotated

from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from core.database import get_db
from core.feature_flags import resolve_features
from core.security import get_current_user
from models import TrainingRecord, User

from .manager import get_plugin_manager

log = logging.getLogger(__name__)

router = APIRouter(tags=["plugins"])


@router.get("/api/plugins/manifest")
async def plugin_manifest(
    request: Request,
    current_user: Annotated[User, Depends(get_current_user)],
):
    pm = get_plugin_manager()
    return pm.generate_manifest()


@router.get("/api/training/{record_id}/plugins/manifest")
async def training_plugin_manifest(
    record_id: int,
    request: Request,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    record = db.query(TrainingRecord).filter(TrainingRecord.id == record_id).first()
    if record is None:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="训练记录不存在")
    features = resolve_features(record.practice_snapshot)
    pm = get_plugin_manager()
    return pm.generate_manifest(features)
```

- [ ] **Step 2: Commit**

```bash
git add backend/plugins/manifest.py
git commit -m "✨ feat: add /api/plugins/manifest and /api/training/{record_id}/plugins/manifest endpoints"
```

---

### Task 4: Modify `core/feature_flags.py` — Move plugin flags out

**Files:**
- Modify: `backend/core/feature_flags.py`

- [ ] **Step 1: Remove plugin feature flags, keep only `allow_pause`**

Read the current file. Remove these entries from `FEATURE_FLAGS` dict:
- `physical_exam`
- `emotion`
- `patient_initiative`
- `portrait`
- `questionnaire`
- `exam_emotion_bridge`

```python
FEATURE_FLAGS: dict[str, FeatureFlag] = {
    "allow_pause": FeatureFlag(
        key="allow_pause",
        label="允许暂停计时",
        default=False,
        description="允许学生在训练中暂停倒计时。后台结算仍以服务器时间为准。",
    ),
}
```

The `resolve_features()`, `is_enabled()` functions remain unchanged (they read from `practice_snapshot.features`, not from `FEATURE_FLAGS`). Add a helper to merge plugin flags:

```python
def all_feature_flags() -> dict[str, FeatureFlag]:
    """Return built-in flags merged with plugin-provided flags."""
    result = dict(FEATURE_FLAGS)
    try:
        from plugins.manager import get_plugin_manager
        pm = get_plugin_manager()
        for plugin in pm._plugins.values():
            ff = plugin.feature_flag
            if ff is not None:
                result[ff.key] = ff
    except Exception:
        pass
    return result
```

- [ ] **Step 2: Run existing feature flag tests**

```bash
cd backend && pytest tests/test_feature_flags.py -v
```

Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add backend/core/feature_flags.py
git commit -m "♻️ refactor: move plugin feature flags from core to plugin modules"
```

---

### Task 5: Modify `main.py` — Integrate PluginManager

**Files:**
- Modify: `backend/main.py`

- [ ] **Step 1: Replace plugin registration and add manifest router**

In the `lifespan()` function, replace:
```python
from contexts.training.plugins import register_all_plugins
register_all_plugins()
log.info("Plugins: registered")
```

With:
```python
from plugins.manager import get_plugin_manager

pm = get_plugin_manager()
pm.discover()
log.info("Plugins: registered (%d discovered)", len(pm._plugins))
```

In the route registration section, add the manifest router:
```python
from plugins.manifest import router as manifest_router
app.include_router(manifest_router)
```

- [ ] **Step 2: Verify app starts (will fail because old callers still reference old plugin system — expected)**

```bash
cd backend && timeout 5 python -c "from main import app; print('OK')" 2>&1 | tail -5
```

Expected: May fail on imports of old pipeline modules. This is expected until Task 11.

- [ ] **Step 3: Commit**

```bash
git add backend/main.py
git commit -m "♻️ refactor: integrate PluginManager into main.py lifespan"
```

---

### Task 6: Modify `backend/contexts/training/pipeline/registry.py` — Use PluginManager.build_pipeline

**Files:**
- Modify: `backend/contexts/training/pipeline/registry.py`

- [ ] **Step 1: Rewrite registry.py**

```python
"""Pipeline registry — dynamically assembles middleware chains per feature flags."""


def get_pipeline(feature_flags: dict[str, bool] | None = None) -> list:
    flags = feature_flags or {}
    from plugins.manager import get_plugin_manager

    pm = get_plugin_manager()
    return pm.build_pipeline(flags)


def build_pipeline(feature_flags: dict[str, bool]) -> list:
    from plugins.manager import get_plugin_manager

    pm = get_plugin_manager()
    return pm.build_pipeline(feature_flags)
```

- [ ] **Step 2: Verify import**

```bash
cd backend && python -c "from contexts.training.pipeline.registry import get_pipeline; print('OK')"
```

Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add backend/contexts/training/pipeline/registry.py
git commit -m "♻️ refactor: pipe get_pipeline through PluginManager.build_pipeline"
```

---

### Task 7: Create EmotionPlugin

**Files:**
- Create: `backend/plugins/emotion/__init__.py`
- Create: `backend/plugins/emotion/plugin.py`
- Create: `backend/plugins/emotion/middleware.py`

- [ ] **Step 1: Create `backend/plugins/emotion/__init__.py`**

```python
"""Emotion plugin — 2D trust-comfort emotional state machine."""
```

- [ ] **Step 2: Create `backend/plugins/emotion/middleware.py`** (same logic, new location)

```python
"""emotion_tracker middleware — classify intent and update emotion model."""

from contexts.patient.emotion import classify_intent, get_emotion


async def emotion_tracker(ctx, next_mw):
    from core.feature_flags import is_enabled

    if ctx.should_shortcut or ctx.error:
        await next_mw()
        return

    if not is_enabled(ctx.record, "emotion"):
        await next_mw()
        return

    student_text = ctx.student_display or ctx.student_input
    if not student_text:
        await next_mw()
        return

    cache = ctx.app_state.emotion_cache
    emotion = get_emotion(ctx.record.id, cache)
    intent = classify_intent(student_text)
    emotion.update(intent)

    ctx.state["emotion_note"] = emotion.note
    ctx.state["_emotion_change"] = {
        "state": emotion.state,
        "trust": emotion.trust,
        "comfort": emotion.comfort,
    }
    ctx.system_events.append(
        {
            "emotion_change": {
                "state": emotion.state,
                "trust": emotion.trust,
                "comfort": emotion.comfort,
            }
        }
    )
    await next_mw()
```

- [ ] **Step 3: Create `backend/plugins/emotion/plugin.py`**

```python
"""EmotionPlugin — 2D trust-comfort emotional state machine."""

from core.feature_flags import FeatureFlag

from plugins.base import EndContext, PipelineStage, Plugin, UIManifest
from plugins.emotion.middleware import emotion_tracker


class EmotionPlugin(Plugin):
    id = "emotion"
    name = "患者情绪状态机"
    description = "2D 信赖-舒适情绪模型，根据学生用语动态变化"
    feature_flag = FeatureFlag(
        key="emotion",
        label="患者情绪状态机",
        default=False,
        description="5态情绪模型（withdrawn/defensive/neutral/relaxed/open），根据学生用语动态变化，注入 author_note 影响患者表现",
    )

    def get_middleware(self):
        return [(PipelineStage.PLUGIN_EARLY, emotion_tracker)]

    async def on_training_end(self, ctx: EndContext) -> None:
        from contexts.patient.emotion import cleanup_emotion

        cleanup_emotion(ctx.record.id, ctx.emotion_cache)

    def ui_manifest(self) -> UIManifest:
        return UIManifest(
            type="panel",
            tab={"icon": "Smile", "label": "情绪状态", "priority": 5},
        )
```

- [ ] **Step 4: Verify plugin module imports**

```bash
cd backend && python -c "from plugins.emotion.plugin import EmotionPlugin; p = EmotionPlugin(); print(p.id, p.name)"
```

Expected: `emotion 患者情绪状态机`

- [ ] **Step 5: Commit**

```bash
git add backend/plugins/emotion/
git commit -m "✨ feat: migrate emotion plugin to new Plugin ABC"
```

---

### Task 8: Create InitiativePlugin

**Files:**
- Create: `backend/plugins/initiative/__init__.py`
- Create: `backend/plugins/initiative/plugin.py`

- [ ] **Step 1: Create `backend/plugins/initiative/__init__.py`**

```python
"""Initiative plugin — patient proactive messaging."""
```

- [ ] **Step 2: Create `backend/plugins/initiative/plugin.py`**

```python
"""InitiativePlugin — patient proactively sends messages based on personality/emotion/wait time."""

from core.feature_flags import FeatureFlag

from plugins.base import EndContext, Plugin, RecordCreateContext, UIManifest


class InitiativePlugin(Plugin):
    id = "initiative"
    name = "患者主动回复"
    description = "患者根据性格/情绪/等待时长主动发言"
    requires = ["emotion"]
    feature_flag = FeatureFlag(
        key="patient_initiative",
        label="患者主动追问",
        default=False,
        description="患者根据性格/情绪/等待时长主动发言（催促、担忧、非语言线索等）",
    )

    async def on_record_create(self, ctx: RecordCreateContext) -> None:
        from contexts.patient.initiative import update_initiative_timer

        update_initiative_timer(ctx.record.id, ctx.initiative_cache)

    async def on_training_end(self, ctx: EndContext) -> None:
        from contexts.patient.initiative import cleanup_initiative

        cleanup_initiative(ctx.record.id, ctx.initiative_cache)

    def ui_manifest(self) -> UIManifest:
        return UIManifest(
            type="panel",
            tab={"icon": "MessageCircle", "label": "主动追问", "priority": 6},
        )
```

- [ ] **Step 3: Commit**

```bash
git add backend/plugins/initiative/
git commit -m "✨ feat: migrate initiative plugin to new Plugin ABC"
```

---

### Task 9: Create PhysicalExamPlugin and ExamEmotionBridgePlugin

**Files:**
- Create: `backend/plugins/physical-exam/__init__.py`
- Create: `backend/plugins/physical-exam/plugin.py`
- Create: `backend/plugins/physical-exam/routes.py`
- Create: `backend/plugins/exam-emotion-bridge/__init__.py`
- Create: `backend/plugins/exam-emotion-bridge/plugin.py`

- [ ] **Step 1: Create `backend/plugins/physical-exam/__init__.py`**

```python
"""Physical exam plugin — nursing exam anchor interaction."""
```

- [ ] **Step 2: Create `backend/plugins/physical-exam/plugin.py`**

```python
"""PhysicalExamPlugin — allows students to perform nursing exam operations."""

from core.feature_flags import FeatureFlag

from plugins.base import Plugin, RouteDef, UIManifest
from plugins.physical_exam.routes import perform_exam


class PhysicalExamPlugin(Plugin):
    id = "physical-exam"
    name = "护理查体锚点交互"
    description = "通过专属 Tab 触发体检操作，结果注入 Author's Note"
    feature_flag = FeatureFlag(
        key="physical_exam",
        label="护理查体",
        default=False,
        description="允许学生触发护理操作（测血压/体温/听诊等），操作结果通过 Author's Note 注入 LLM",
    )

    def get_routes(self) -> list[RouteDef]:
        return [
            RouteDef(
                method="POST",
                path="/api/training/{record_id}/exam/{op_type}",
                handler=perform_exam,
            )
        ]

    def ui_manifest(self) -> UIManifest:
        return UIManifest(
            type="panel",
            tab={"icon": "Stethoscope", "label": "护理查体", "priority": 3},
            actions=[
                {"id": "exam_temp", "label": "体温", "type": "exam", "op_type": "temp"},
                {"id": "exam_bp", "label": "血压", "type": "exam", "op_type": "bp"},
                {"id": "exam_hr", "label": "心率", "type": "exam", "op_type": "hr"},
                {"id": "exam_rr", "label": "呼吸", "type": "exam", "op_type": "rr"},
                {"id": "exam_spo2", "label": "血氧", "type": "exam", "op_type": "spo2"},
                {"id": "exam_vitals", "label": "全套生命体征", "type": "exam", "op_type": "vitals"},
                {"id": "exam_skin", "label": "皮肤检查", "type": "exam", "op_type": "skin"},
                {"id": "exam_pain", "label": "疼痛评估", "type": "exam", "op_type": "pain"},
            ],
        )
```

- [ ] **Step 3: Create `backend/plugins/physical-exam/routes.py`** 

Move the existing `perform_exam` endpoint logic here. Wrap in a function that accepts the same parameters as before but is self-contained:

```python
"""Physical exam routes — exam operation endpoint."""

import logging
from typing import Annotated

from fastapi import Depends, HTTPException, Request
from sqlalchemy.orm import Session

from contexts.patient import handle_operation
from core.database import get_db
from core.feature_flags import resolve_features
from core.security import get_current_user
from models import Case, Message, TrainingRecord, User
from plugins.manager import get_plugin_manager

log = logging.getLogger(__name__)


def perform_exam(
    record_id: int,
    op_type: str,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
    request: Request,
):
    record = db.query(TrainingRecord).filter(TrainingRecord.id == record_id).first()
    if not record:
        raise HTTPException(status_code=404, detail="训练记录不存在")
    if record.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="只能操作自己的训练")
    if record.status != "in_progress":
        raise HTTPException(status_code=400, detail="训练已结束")

    case = db.query(Case).filter(Case.id == record.case_id).first()
    if not case:
        raise HTTPException(status_code=404, detail="病例不存在")

    result = handle_operation(op_type, case.case_data or {})

    snapshot = record.practice_snapshot or {}
    exam_results = snapshot.get("_exam_results", [])
    if not isinstance(exam_results, list):
        exam_results = []
    exam_results.append(
        {
            "type": op_type,
            "label": result.get("label", ""),
            "value": str(result.get("value", "")),
            "unit": result.get("unit", ""),
        }
    )
    snapshot["_exam_results"] = exam_results
    record.practice_snapshot = snapshot

    msg = Message(
        record_id=record_id,
        role="system",
        content=f"{result.get('label', '')}: {result.get('value', '')}{result.get('unit', '')}",
    )
    db.add(msg)

    features = resolve_features(record.practice_snapshot)
    if features.get("exam_emotion_bridge") and features.get("emotion"):
        last_student_msg = (
            db.query(Message)
            .filter(Message.record_id == record_id, Message.role == "student")
            .order_by(Message.created_at.desc())
            .first()
        )
        explained = bool(last_student_msg and _has_explanation(last_student_msg.content))
        exam_count = len(exam_results)
        from plugins.manager import get_plugin_manager
        from plugins.base import ExamContext

        pm = get_plugin_manager()
        ctx = ExamContext(
            record=record,
            emotion_cache=request.app.state.emotion_cache,
            op_type=op_type,
            explanation_given=explained,
            exam_count=exam_count,
        )
        results_list = pm.run_hook("on_exam", ctx, features)
        for effect in results_list:
            if effect is not None:
                if effect.snapshot_updates:
                    snap = record.practice_snapshot or {}
                    snap.update(effect.snapshot_updates)
                    record.practice_snapshot = snap

    db.commit()
    return {"type": op_type, "data": result, "all_results": exam_results}


def _has_explanation(text: str) -> bool:
    keywords = ["因为", "所以", "给你", "检查一下", "评估", "需要了解", "测量一下", "看一下", "查一下"]
    return any(kw in text for kw in keywords)
```

- [ ] **Step 4: Create `backend/plugins/exam-emotion-bridge/__init__.py`**

```python
"""Exam-emotion bridge plugin — exam operations affect patient emotion."""
```

- [ ] **Step 5: Create `backend/plugins/exam-emotion-bridge/plugin.py`**

```python
"""ExamEmotionBridgePlugin — exam operations impact patient trust/comfort."""

from core.feature_flags import FeatureFlag

from plugins.base import EndContext, ExamContext, ExamEffect, Plugin


EXAM_EMOTION_IMPACT: dict[str, dict] = {
    "temp": {"category": "routine", "trust_no": 0, "comfort_no": -1, "trust_yes": 0, "comfort_yes": 0},
    "bp": {"category": "routine", "trust_no": 0, "comfort_no": -1, "trust_yes": 0, "comfort_yes": 0},
    "hr": {"category": "routine", "trust_no": 0, "comfort_no": -1, "trust_yes": 0, "comfort_yes": 0},
    "rr": {"category": "routine", "trust_no": 0, "comfort_no": -1, "trust_yes": 0, "comfort_yes": 0},
    "spo2": {"category": "routine", "trust_no": 0, "comfort_no": -1, "trust_yes": 0, "comfort_yes": 0},
    "vitals": {"category": "bundle", "trust_no": 0, "comfort_no": -3, "trust_yes": 0, "comfort_yes": -1},
    "skin": {"category": "moderate", "trust_no": -2, "comfort_no": -5, "trust_yes": -1, "comfort_yes": -2},
    "pain": {"category": "moderate", "trust_no": -1, "comfort_no": -3, "trust_yes": 0, "comfort_yes": -1},
}

_CUMULATIVE_THRESHOLDS: list[tuple[int, int, int]] = [
    (4, 0, -2),
    (7, -1, -4),
    (10, -2, -6),
]

_EXAM_EMOTION_IMPACT_LABELS: dict[str, str] = {
    "temp": "体温测量",
    "bp": "血压测量",
    "hr": "心率测量",
    "rr": "呼吸频率测量",
    "spo2": "血氧测量",
    "vitals": "全套生命体征",
    "skin": "皮肤检查",
    "pain": "疼痛评估",
}


class ExamEmotionBridgePlugin(Plugin):
    id = "exam-emotion-bridge"
    name = "查体-情绪联动"
    description = "查体操作会影响患者心态：缺少解释或进行不相关检查时信任/舒适下降"
    requires = ["emotion", "physical-exam"]
    feature_flag = FeatureFlag(
        key="exam_emotion_bridge",
        label="查体-情绪联动",
        default=False,
        description="查体操作影响患者心态：缺乏解释或不相关检查会降低信任/舒适度",
    )

    async def on_exam(self, ctx: ExamContext) -> ExamEffect | None:
        return _apply_exam_emotion_effect(ctx)


def _apply_exam_emotion_effect(ctx: ExamContext) -> ExamEffect | None:
    from contexts.patient.emotion import get_emotion

    emotion = get_emotion(ctx.record.id, ctx.emotion_cache)
    impact = EXAM_EMOTION_IMPACT.get(ctx.op_type)
    if not impact:
        return None

    suffix = "yes" if ctx.explanation_given else "no"
    dt = impact.get(f"trust_{suffix}", 0)
    dc = impact.get(f"comfort_{suffix}", 0)

    for threshold, ct_dt, ct_dc in _CUMULATIVE_THRESHOLDS:
        if ctx.exam_count >= threshold:
            dt += ct_dt
            dc += ct_dc
            break

    explained_routine = impact["category"] == "routine" and ctx.explanation_given
    if explained_routine and dc < 0:
        dc += 1

    if dt != 0 or dc != 0:
        emotion.trust = max(0, min(100, emotion.trust + dt))
        emotion.comfort = max(0, min(100, emotion.comfort + dc))
        emotion.history.append(
            {
                "trust": emotion.trust,
                "comfort": emotion.comfort,
                "state": emotion.state,
                "intent": f"查体:{ctx.op_type}",
                "timestamp": "",
            }
        )

    impact_note = _build_impact_note(ctx.op_type, impact, dt, dc, ctx.exam_count, ctx.explanation_given)
    effect = ExamEffect(
        emotion_delta=(dt, dc),
    )
    if impact_note:
        effect.snapshot_updates["_exam_impact_note"] = impact_note
    return effect


def _build_impact_note(
    op_type: str, impact: dict, dt: int, dc: int, exam_count: int, explained: bool
) -> str | None:
    label = _EXAM_EMOTION_IMPACT_LABELS.get(op_type, op_type)
    category = impact["category"]

    parts = [f"患者刚接受了{label}"]

    if not explained:
        if category == "routine":
            parts.append("护士没有解释原因，患者感到些许不适")
        elif category == "bundle":
            parts.append("护士没有解释为何要做全套检查，患者感到被当作'流程'对待")
        elif category == "moderate":
            parts.append("这项检查让患者感到尴尬和暴露，护士也没有事先说明必要性")
    elif category == "routine":
        parts.append("护士解释了原因，患者基本接受")
    elif category == "bundle":
        parts.append("护士解释了全套检查的必要性，患者勉强配合但感到紧张")
    elif category == "moderate":
        parts.append("虽然护士做了解释，患者仍然感到不适")

    if exam_count >= 7:
        parts.append(f"这已经是第{exam_count}次检查，患者开始怀疑是否必要")
    elif exam_count >= 4:
        parts.append("频繁的检查让患者有些不耐烦")

    if dt < 0 and dc < 0:
        parts.append(f"信任{dt:+d}，舒适{dc:+d}")
    elif dc < 0:
        parts.append(f"舒适{dc:+d}")
    elif dt < 0:
        parts.append(f"信任{dt:+d}")

    return " | ".join(parts)
```

- [ ] **Step 6: Commit**

```bash
git add backend/plugins/physical-exam/ backend/plugins/exam-emotion-bridge/
git commit -m "✨ feat: migrate physical-exam and exam-emotion-bridge plugins to Plugin ABC"
```

---

### Task 10: Update callers — session.py, progress.py, scoring.py, chat.py

**Files:**
- Modify: `backend/contexts/training/router/session.py`
- Modify: `backend/contexts/training/router/progress.py`
- Modify: `backend/contexts/training/router/scoring.py`

- [ ] **Step 1: Update session.py on_record_create hook call**

In `_create_record()` (around line 202-208), replace:
```python
    from contexts.training.pipeline.plugin import run_plugin_hooks
    from contexts.training.plugins import _hook_ctx
    from core.feature_flags import resolve_features

    features = resolve_features(record.practice_snapshot)
    if app_state is not None:
        run_plugin_hooks("on_record_create", _hook_ctx(record, app_state), features)
```

With:
```python
    from plugins.manager import get_plugin_manager
    from plugins.base import RecordCreateContext
    from core.feature_flags import resolve_features

    features = resolve_features(record.practice_snapshot)
    if app_state is not None:
        import asyncio
        pm = get_plugin_manager()
        ctx = RecordCreateContext(
            record=record,
            emotion_cache=app_state.emotion_cache,
            initiative_cache=app_state.initiative_cache,
        )
        asyncio.run(pm.run_hook("on_record_create", ctx, features))
```

- [ ] **Step 2: Update scoring.py on_end hook call**

Around line 164-169, replace:
```python
    from contexts.training.plugins import _hook_ctx
    from core.feature_flags import resolve_features

    features = resolve_features(record.practice_snapshot)
    hook_ctx = _hook_ctx(record, request.app.state)
    run_plugin_hooks("on_end", hook_ctx, features)
```

With:
```python
    from plugins.manager import get_plugin_manager
    from plugins.base import EndContext
    from core.feature_flags import resolve_features

    features = resolve_features(record.practice_snapshot)
    pm = get_plugin_manager()
    ctx = EndContext(
        record=record,
        emotion_cache=request.app.state.emotion_cache,
        initiative_cache=request.app.state.initiative_cache,
    )
    import asyncio
    asyncio.run(pm.run_hook("on_training_end", ctx, features))
```

- [ ] **Step 3: Remove old exam endpoint route from progress.py**

The `/api/training/{record_id}/exam/{op_type}` endpoint in `progress.py` (lines 264-309) is now registered via `PhysicalExamPlugin.get_routes()`. Remove the route decorator and function from `progress.py`. Keep all other routes (`advance-phase`, `state`, `initiative/trigger`, `emotion/history`, `initiative/history`) unchanged.

- [ ] **Step 4: Commit**

```bash
git add backend/contexts/training/router/session.py backend/contexts/training/router/scoring.py backend/contexts/training/router/progress.py
git commit -m "♻️ refactor: update hook callers to use PluginManager with typed contexts"
```

---

### Task 11: Clean up old plugin files

**Files:**
- Delete: `backend/contexts/training/pipeline/plugin.py` (old Plugin dataclass + _registry)
- Delete: `backend/contexts/training/plugins.py` (old plugin instances)
- Modify: `backend/contexts/training/pipeline/__init__.py` (remove run_plugin_hooks export)
- Modify: `backend/contexts/training/pipeline/middleware/__init__.py` (remove emotion_tracker)

- [ ] **Step 1: Update `backend/contexts/training/pipeline/__init__.py`**

Remove `run_plugin_hooks` from imports and `__all__`:
```python
"""Training Pipeline — composable middleware chain for message processing."""

from .context import PipelineContext
from .phase import (
    Phase,
    get_phase_by_order,
    parse_phase,
    parse_phases,
    try_advance_phase,
)
from .registry import get_pipeline
from .runner import PipelineMiddleware, run_pipeline, stream_pipeline

__all__ = [
    "Phase",
    "PipelineContext",
    "PipelineMiddleware",
    "get_phase_by_order",
    "get_pipeline",
    "parse_phase",
    "parse_phases",
    "run_pipeline",
    "stream_pipeline",
    "try_advance_phase",
]
```

- [ ] **Step 2: Update `backend/contexts/training/pipeline/middleware/__init__.py`**

Remove `emotion_tracker` from imports and `__all__`:
```python
from .llm_caller import llm_caller
from .persister import persister
from .phase_guard import phase_guard
from .phase_transition import phase_transition
from .prompt_builder import prompt_builder
from .side_effects import side_effects

__all__ = [
    "llm_caller",
    "persister",
    "phase_guard",
    "phase_transition",
    "prompt_builder",
    "side_effects",
]
```

- [ ] **Step 3: Delete old files**

```bash
rm backend/contexts/training/pipeline/plugin.py
rm backend/contexts/training/plugins.py
```

- [ ] **Step 4: Remove unused import from chat.py**

In `chat.py`, there's no direct import of `run_plugin_hooks` — verify and clean any stale imports.

- [ ] **Step 5: Commit**

```bash
git add backend/contexts/training/pipeline/__init__.py backend/contexts/training/pipeline/middleware/__init__.py
git rm backend/contexts/training/pipeline/plugin.py backend/contexts/training/plugins.py
git commit -m "🔥 remove: delete old pipeline plugin system files"
```

---

### Task 12: Register physical-exam routes via PluginManager

**Files:**
- Modify: `backend/main.py`

- [ ] **Step 1: Add route registration after plugin discovery**

In the lifespan, after `pm.discover()`, add:
```python
    from contexts.training import nursing_router
    pm.register_routes(nursing_router)
```

- [ ] **Step 2: Commit**

```bash
git add backend/main.py
git commit -m "♻️ refactor: register plugin routes via PluginManager"
```

---

### Task 13: Backend integration test — verify app starts and manifest works

**Files:**
- Create: `backend/tests/test_plugin_system.py`

- [ ] **Step 1: Write plugin system tests**

```python
"""Tests for the new plugin system."""

import pytest
from unittest.mock import MagicMock, patch


class TestPluginManager:
    def test_register_and_get_active(self):
        from plugins.manager import PluginManager
        from plugins.base import PipelineStage

        pm = PluginManager()

        class FakePlugin:
            id = "fake"
            name = "Fake"
            feature_flag = None
            requires = []
            def get_middleware(self):
                return []
            def get_routes(self):
                return []
            def ui_manifest(self):
                return None

        pm.register(FakePlugin())
        active = pm.get_active({})
        assert len(active) == 1
        assert active[0].id == "fake"

    def test_feature_flag_filtering(self):
        from plugins.manager import PluginManager
        from core.feature_flags import FeatureFlag

        pm = PluginManager()
        ff = FeatureFlag(key="test_flag", label="Test", default=False, description="")

        class FlaggedPlugin:
            id = "flagged"
            name = "Flagged"
            feature_flag = ff
            requires = []
            def get_middleware(self):
                return []
            def get_routes(self):
                return []
            def ui_manifest(self):
                return None

        pm.register(FlaggedPlugin())
        assert len(pm.get_active({})) == 0
        assert len(pm.get_active({"test_flag": True})) == 1

    def test_requires_dependency_chain(self):
        from plugins.manager import PluginManager
        from core.feature_flags import FeatureFlag

        pm = PluginManager()
        ff = FeatureFlag(key="base_flag", label="Base", default=False, description="")

        class BasePlugin:
            id = "base"
            name = "Base"
            feature_flag = ff
            requires = []
            def get_middleware(self):
                return []
            def get_routes(self):
                return []
            def ui_manifest(self):
                return None

        class DepPlugin:
            id = "dependent"
            name = "Dependent"
            feature_flag = None
            requires = ["base"]
            def get_middleware(self):
                return []
            def get_routes(self):
                return []
            def ui_manifest(self):
                return None

        pm.register(BasePlugin())
        pm.register(DepPlugin())
        # Dependent should not be active when base flag is off
        assert len(pm.get_active({})) == 0
        assert len(pm.get_active({"base_flag": True})) == 2

    def test_build_pipeline_returns_list(self):
        from plugins.manager import PluginManager

        pm = PluginManager()
        pipeline = pm.build_pipeline({})
        assert isinstance(pipeline, list)
        # Core middleware are always included; at least 6
        assert len(pipeline) >= 6

    def test_generate_manifest_structure(self):
        from plugins.manager import PluginManager

        pm = PluginManager()
        manifest = pm.generate_manifest({})
        assert "plugins" in manifest
        assert "feature_flags" in manifest
        assert isinstance(manifest["plugins"], list)
        assert isinstance(manifest["feature_flags"], dict)


class TestPipelineStage:
    def test_stage_ordering(self):
        from plugins.base import PipelineStage, stage_order

        assert stage_order(PipelineStage.GUARD) < stage_order(PipelineStage.PLUGIN_EARLY)
        assert stage_order(PipelineStage.PLUGIN_EARLY) < stage_order(PipelineStage.TRANSITION)
        assert stage_order(PipelineStage.TRANSITION) < stage_order(PipelineStage.PROMPT)
        assert stage_order(PipelineStage.PROMPT) < stage_order(PipelineStage.LLM)
        assert stage_order(PipelineStage.LLM) < stage_order(PipelineStage.PERSIST)
        assert stage_order(PipelineStage.PERSIST) < stage_order(PipelineStage.SIDE_EFFECTS)


class TestEmotionPlugin:
    def test_plugin_instantiation(self):
        from plugins.emotion.plugin import EmotionPlugin

        p = EmotionPlugin()
        assert p.id == "emotion"
        assert p.name == "患者情绪状态机"
        assert p.requires == []

    def test_returns_middleware(self):
        from plugins.emotion.plugin import EmotionPlugin
        from plugins.base import PipelineStage

        p = EmotionPlugin()
        mw_list = p.get_middleware()
        assert len(mw_list) == 1
        assert mw_list[0][0] == PipelineStage.PLUGIN_EARLY

    def test_ui_manifest(self):
        from plugins.emotion.plugin import EmotionPlugin

        p = EmotionPlugin()
        ui = p.ui_manifest()
        assert ui is not None
        assert ui.type == "panel"
        assert ui.tab["icon"] == "Smile"
```

- [ ] **Step 2: Run tests**

```bash
cd backend && pytest tests/test_plugin_system.py -v -m "not pg"
```

Expected: All tests PASS

- [ ] **Step 3: Commit**

```bash
git add backend/tests/test_plugin_system.py
git commit -m "✅ test: add PluginManager, PipelineStage, and EmotionPlugin unit tests"
```

---

### Task 14: Frontend — Update types.ts with manifest types and definePlugin

**Files:**
- Modify: `frontend/src/engine/types.ts`

- [ ] **Step 1: Add manifest types and FrontendPlugin to types.ts**

Append to `frontend/src/engine/types.ts`:

```typescript
// ── Backend Manifest types ──

export interface ManifestPlugin {
  id: string;
  name: string;
  description?: string;
  feature_flag?: string;
  requires: string[];
  ui?: ManifestUI;
}

export interface ManifestUI {
  type: "panel" | "overlay";
  tab?: {
    icon: string;
    label: string;
    priority?: number;
    badge?: string;
  };
  actions?: ManifestAction[];
}

export interface ManifestAction {
  id: string;
  label: string;
  type: string;
  op_type?: string;
}

export interface ManifestResponse {
  plugins: ManifestPlugin[];
  feature_flags: Record<string, {
    key: string;
    label: string;
    default: boolean;
    description: string;
  }>;
}

// ── Frontend Plugin (local definition) ──

export interface FrontendPluginDef {
  id: string;
  meta: { name: string; description?: string };
  tab?: {
    icon: string;
    label: string;
    priority?: number;
    badge?: (ctx: PluginContext) => BadgeInfo | null;
  };
  component?: ComponentType<PanelTabProps>;
  hooks?: PluginHooks;
  overlayComponent?: ComponentType<{ recordId: string; bus: MessageBus; features: Record<string, boolean> }>;
}

export function definePlugin(def: FrontendPluginDef): FrontendPluginDef {
  return def;
}
```

- [ ] **Step 2: Remove `featureFlag` and `requires` from `PanelPlugin`**

The `PanelPlugin` interface should be kept for internal use (backed by manifest + FrontendPluginDef). Remove `featureFlag` and `requires` from it — these now come from the manifest:

```typescript
export interface PanelPlugin {
  id: string;
  meta: { name: string; description?: string };
  tab: {
    icon: ComponentType<{ size?: number }>;
    label: string;
    badge?: (ctx: PluginContext) => BadgeInfo | null;
    priority?: number;
  };
  component: ComponentType<PanelTabProps>;
  hooks?: PluginHooks;
}
```

- [ ] **Step 3: Verify tsc**

```bash
cd frontend && npx tsc --noEmit 2>&1 | head -30
```

Expected: May show errors in files that still reference old `featureFlag`/`requires` on `PanelPlugin`. These will be fixed in Tasks 15-18.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/engine/types.ts
git commit -m "✨ feat: add ManifestPlugin, ManifestResponse, FrontendPluginDef, definePlugin to types"
```

---

### Task 15: Frontend — Create discovery.ts (vite glob auto-discovery)

**Files:**
- Create: `frontend/src/engine/discovery.ts`

- [ ] **Step 1: Write discovery module**

```typescript
import type { ComponentType } from "react";
import type { FrontendPluginDef, PanelTabProps } from "./types";

interface PluginModule {
  default: FrontendPluginDef;
}

const pluginModules = import.meta.glob<PluginModule>(
  "@/plugins/*/index.ts",
  { eager: true }
);

const ICON_MAP: Record<string, ComponentType<{ size?: number }>> = {};

async function loadIcons(iconNames: string[]) {
  const unique = [...new Set(iconNames)];
  const icons = await import("lucide-react");
  for (const name of unique) {
    const comp = (icons as Record<string, ComponentType<{ size?: number }>>)[name];
    if (comp) ICON_MAP[name] = comp;
  }
}

let discovered: FrontendPluginDef[] | null = null;

export function discoverPluginDefs(): FrontendPluginDef[] {
  if (discovered) return discovered;
  discovered = Object.values(pluginModules)
    .filter((m): m is PluginModule => !!m?.default?.id)
    .map((m) => m.default);
  return discovered;
}

export function resolveIcon(name: string): ComponentType<{ size?: number }> | undefined {
  return ICON_MAP[name];
}

export function populateIconMap(): void {
  const defs = discoverPluginDefs();
  const iconNames = defs
    .map((d) => d.tab?.icon)
    .filter((n): n is string => !!n);
  loadIcons(iconNames);
}
```

Wait — `import.meta.glob` with `{ eager: true }` cannot load icons asynchronously later. Let's use a different approach for icon resolution: export a map directly from each plugin index.

Actually, rethinking: the simplest approach is to keep the plugin modules exporting their React components directly (including icon components). The `import.meta.glob` with `{ eager: true }` loads all modules at build time. The icon is already a React component, not a string. Let me adjust:

```typescript
import type { FrontendPluginDef } from "./types";

interface PluginModule {
  default: FrontendPluginDef;
}

const pluginModules = import.meta.glob<PluginModule>(
  "@/plugins/*/index.ts",
  { eager: true }
);

let discovered: FrontendPluginDef[] | null = null;

export function discoverPluginDefs(): FrontendPluginDef[] {
  if (discovered) return discovered;
  discovered = Object.values(pluginModules)
    .filter((m): m is PluginModule => !!m?.default?.id)
    .map((m) => m.default);
  return discovered;
}
```

Each plugin index.ts will export its tab icon as a React component directly using lucide imports (same as today). The `tab.icon` in the FrontendPluginDef will still be `ComponentType<{size?: number}>`.

- [ ] **Step 2: Commit**

```bash
git add frontend/src/engine/discovery.ts
git commit -m "✨ feat: add vite glob auto-discovery for frontend plugins"
```

---

### Task 16: Frontend — Create manifest.ts (fetchManifest + useManifest)

**Files:**
- Create: `frontend/src/engine/manifest.ts`

- [ ] **Step 1: Write manifest module**

```typescript
import { useEffect, useState } from "react";
import { api } from "@/api/axios-instance";
import type { ManifestResponse } from "./types";

let cachedManifest: ManifestResponse | null = null;
let cachedRecordId: string | null = null;

export async function fetchManifest(recordId?: string): Promise<ManifestResponse> {
  const url = recordId
    ? `/training/${recordId}/plugins/manifest`
    : "/plugins/manifest";

  const res = await api.get<ManifestResponse>(url);
  cachedManifest = res.data;
  cachedRecordId = recordId ?? null;
  return res.data;
}

export function useManifest(recordId?: string) {
  const [manifest, setManifest] = useState<ManifestResponse | null>(cachedManifest);
  const [loading, setLoading] = useState(!cachedManifest);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchManifest(recordId)
      .then((m) => {
        if (!cancelled) setManifest(m);
      })
      .catch(() => {
        if (!cancelled) setManifest(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [recordId]);

  return { manifest, loading };
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/engine/manifest.ts
git commit -m "✨ feat: add manifest fetch and useManifest hook"
```

---

### Task 17: Frontend — Update PluginRegistry to merge manifest with local plugins

**Files:**
- Modify: `frontend/src/engine/PluginRegistry.ts`

- [ ] **Step 1: Rewrite PluginRegistry**

The registry now merges manifest data with locally discovered plugins. `isActive` uses manifest features, not local `featureFlag`/`requires`.

```typescript
import type { PanelPlugin } from "./types";

export class PluginRegistry {
  private plugins = new Map<string, PanelPlugin>();
  private featureFlags: Record<string, boolean> = {};
  private _version = 0;
  private manifestPlugins: Array<{
    id: string;
    requires: string[];
    feature_flag?: string;
  }> = [];

  get version(): number {
    return this._version;
  }

  register(plugin: PanelPlugin): void {
    if (this.plugins.has(plugin.id)) {
      return;
    }
    this.plugins.set(plugin.id, { ...plugin });
    this._version++;
  }

  setManifest(manifest: { plugins: Array<{ id: string; requires: string[]; feature_flag?: string }> }): void {
    this.manifestPlugins = manifest.plugins;
    this._version++;
  }

  getAll(): PanelPlugin[] {
    return Array.from(this.plugins.values());
  }

  getActive(featureFlags?: Record<string, boolean>): PanelPlugin[] {
    const flags = featureFlags ?? this.featureFlags;
    const manifestMap = new Map(
      this.manifestPlugins.map((p) => [p.id, p])
    );
    return Array.from(this.plugins.values())
      .filter((p) => {
        const mp = manifestMap.get(p.id);
        if (!mp) return false;
        return this._isActiveInManifest(mp, manifestMap, flags);
      })
      .sort((a, b) => (a.tab.priority ?? 99) - (b.tab.priority ?? 99));
  }

  private _isActiveInManifest(
    mp: { id: string; requires: string[]; feature_flag?: string },
    manifestMap: Map<string, { id: string; requires: string[]; feature_flag?: string }>,
    flags: Record<string, boolean>,
  ): boolean {
    if (mp.feature_flag !== undefined) {
      if (!flags[mp.feature_flag]) return false;
    }
    for (const depId of mp.requires) {
      const dep = manifestMap.get(depId);
      if (!dep) return false;
      if (!this._isActiveInManifest(dep, manifestMap, flags)) return false;
    }
    return true;
  }

  setFeatureFlags(flags: Record<string, boolean>): void {
    this.featureFlags = { ...flags };
    this._version++;
  }
}

export const pluginRegistry = new PluginRegistry();
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/engine/PluginRegistry.ts
git commit -m "♻️ refactor: PluginRegistry merges manifest data for activation decisions"
```

---

### Task 18: Frontend — Type MessageBus

**Files:**
- Modify: `frontend/src/engine/MessageBus.ts`

- [ ] **Step 1: Add typed wrapper**

Keep the existing `createMessageBus()` for internal use. Add `TypedMessageBus`:

```typescript
import type { MessageBus, ScoreData } from "./types";

export interface BusEvents {
  "stream:chunk": [];
  "stream:done": [replyId?: number];
  "stream:error": [err: string];
  "training:ended": [];
  "score:ready": [score: ScoreData];
  "emotion:changed": [{ state: string; trust: number; comfort: number }];
  "initiative:state": [{ elapsed_seconds?: number; threshold_seconds?: number; percent?: number }];
  "initiative:triggered": [{ content: string }];
  "exam:result": [{ type: string; data: Record<string, unknown> }];
  "plugins:updated": [];
  "portrait:changed": [{ url: string }];
}

export class TypedMessageBus implements MessageBus {
  constructor(private raw: MessageBus) {}

  on<E extends keyof BusEvents>(event: E, handler: (...args: BusEvents[E]) => void): () => void {
    return this.raw.on(event as string, handler as (...args: any[]) => void);
  }

  emit<E extends keyof BusEvents>(event: E, ...args: BusEvents[E]): void {
    this.raw.emit(event as string, ...args);
  }

  off(event: string, handler: (...args: any[]) => void): void {
    this.raw.off(event, handler);
  }

  listEvents(): string[] {
    return this.raw.listEvents();
  }
}

export function createMessageBus(): MessageBus {
  const listeners = new Map<string, Set<(...args: any[]) => void>>();

  return {
    on(event: string, handler: (...args: any[]) => void): () => void {
      if (!listeners.has(event)) {
        listeners.set(event, new Set());
      }
      listeners.get(event)!.add(handler);
      return () => {
        listeners.get(event)?.delete(handler);
      };
    },

    emit(event: string, ...args: any[]): void {
      const handlers = listeners.get(event);
      if (!handlers) return;
      for (const h of handlers) {
        try {
          h(...args);
        } catch (e) {
          console.error(`[MessageBus] error in handler for "${event}":`, e);
        }
      }
    },

    off(event: string, handler: (...args: any[]) => void): void {
      listeners.get(event)?.delete(handler);
    },

    listEvents(): string[] {
      return Array.from(listeners.keys());
    },
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/engine/MessageBus.ts
git commit -m "✨ feat: add TypedMessageBus with BusEvents type safety"
```

---

### Task 19: Frontend — Create PluginErrorBoundary

**Files:**
- Create: `frontend/src/components/training/PluginErrorBoundary.tsx`

- [ ] **Step 1: Write error boundary**

```typescript
import { Component, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";

interface Props {
  pluginName: string;
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

export class PluginErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error) {
    console.error(`[PluginErrorBoundary] ${this.props.pluginName}:`, error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center p-4 text-center text-muted-foreground">
          <AlertTriangle className="size-8 mb-2 text-destructive" />
          <p className="text-xs font-medium">插件加载失败</p>
          <p className="text-[10px] mt-1">{this.props.pluginName}</p>
        </div>
      );
    }
    return this.props.children;
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/training/PluginErrorBoundary.tsx
git commit -m "✨ feat: add PluginErrorBoundary to isolate plugin tab crashes"
```

---

### Task 20: Frontend — Migrate all 8 frontend plugins to definePlugin

**Files:**
- Modify: `frontend/src/plugins/emotion/index.ts`
- Modify: `frontend/src/plugins/initiative/index.ts`
- Modify: `frontend/src/plugins/physical-exam/index.ts`
- Modify: `frontend/src/plugins/patient-info/index.ts`
- Modify: `frontend/src/plugins/inquiry/index.ts`
- Modify: `frontend/src/plugins/nursing-record/index.ts`
- Modify: `frontend/src/plugins/portrait/index.ts`
- Modify: `frontend/src/plugins/questionnaire/index.ts`
- Modify: `frontend/src/plugins/scoring-display/index.ts`

- [ ] **Step 1: emotion/index.ts**

```typescript
import { Smile } from "lucide-react";
import { definePlugin } from "@/engine/types";
import { EmotionTab } from "./EmotionTab";

export default definePlugin({
  id: "emotion",
  meta: { name: "情绪状态", description: "患者情绪状态机追踪" },
  tab: { icon: Smile, label: "情绪状态", priority: 5 },
  component: EmotionTab,
});
```

(Remove `featureFlag` and `requires` — now from manifest.)

- [ ] **Step 2: initiative/index.ts**

```typescript
import { MessageCircle } from "lucide-react";
import { definePlugin } from "@/engine/types";
import { InitiativeTab } from "./InitiativeTab";

export default definePlugin({
  id: "initiative",
  meta: { name: "主动追问", description: "患者定时主动追问" },
  tab: { icon: MessageCircle, label: "主动追问", priority: 6 },
  component: InitiativeTab,
  hooks: {
    onInit: (ctx) => {
      let stopped = false;
      const interval = setInterval(async () => {
        if (stopped) return;
        try {
          const { getTrainingState } = await import("@/api/training-state");
          const state = await getTrainingState(Number(ctx.recordId));
          const initiative = state.data.initiative;
          ctx.bus.emit("initiative:state", initiative);
          if ((initiative as any)?.should_trigger) {
            const { triggerInitiative } = await import("@/api/training-state");
            const res = await triggerInitiative(Number(ctx.recordId));
            if (res.data.triggered && res.data.message) {
              ctx.bus.emit("initiative:triggered", { content: res.data.message });
            }
          }
        } catch { /* ignore */ }
      }, 5000);
      const unsub = ctx.bus.on("training:ended", () => {
        stopped = true;
        clearInterval(interval);
      });
      return () => { stopped = true; clearInterval(interval); unsub(); };
    },
  },
});
```

- [ ] **Step 3: physical-exam/index.ts**

```typescript
import { Stethoscope } from "lucide-react";
import { definePlugin } from "@/engine/types";
import { ExamPanel } from "./ExamPanel";

const TOTAL_EXAMS = 8;

export default definePlugin({
  id: "physical-exam",
  meta: { name: "护理查体", description: "通过专属面板执行体检操作" },
  tab: {
    icon: Stethoscope,
    label: "护理查体",
    priority: 3,
    badge: (ctx) => {
      let count = 0;
      for (const msg of ctx.messages) {
        if (msg.role === "system") {
          const stripped = (msg.content ?? "").replace(/[:\s]/g, "");
          if (
            stripped.includes("生命体征") || stripped.includes("体温") ||
            stripped.includes("心率") || stripped.includes("血压") ||
            stripped.includes("血氧") || stripped.includes("呼吸") ||
            stripped.includes("皮肤") || stripped.includes("疼痛")
          ) { count++; }
        }
      }
      if (count === 0) return null;
      return { text: `${count}/${TOTAL_EXAMS}`, variant: "default" as const };
    },
  },
  component: ExamPanel,
});
```

- [ ] **Step 4: patient-info/index.ts**

```typescript
import { User } from "lucide-react";
import { definePlugin } from "@/engine/types";
import { PatientInfoTab } from "./PatientInfoTab";

export default definePlugin({
  id: "patient-info",
  meta: { name: "患者情况", description: "患者基本信息和病历" },
  tab: { icon: User, label: "患者情况", priority: 0 },
  component: PatientInfoTab,
});
```

- [ ] **Step 5: inquiry/index.ts**

```typescript
import { ListChecks } from "lucide-react";
import { definePlugin } from "@/engine/types";
import { InquiryTab } from "./InquiryTab";

export default definePlugin({
  id: "inquiry",
  meta: { name: "问诊进度", description: "展示问诊要求完成进度" },
  tab: {
    icon: ListChecks,
    label: "问诊进度",
    priority: 1,
    badge: (ctx) => {
      const inquiries = ctx.patient.requiredInquiries ?? [];
      if (inquiries.length === 0) return null;
      const studentMsgs = ctx.messages.filter((m) => m.role === "student");
      const done = inquiries.filter((inq) =>
        studentMsgs.some((m) =>
          (m.content ?? "").toLowerCase().includes(inq.toLowerCase().slice(0, 4))
        )
      ).length;
      return { text: `${done}/${inquiries.length}`, variant: "default" };
    },
  },
  component: InquiryTab,
});
```

- [ ] **Step 6: nursing-record/index.ts**

```typescript
import { ClipboardList } from "lucide-react";
import { definePlugin } from "@/engine/types";
import { NURSING_RECORD_SHEET_CONFIG } from "./config";
import { NursingRecordPanel } from "./NursingRecordPanel";

export { ITEM_COMPONENTS } from "./items/registry";

const TOTAL_ITEMS = NURSING_RECORD_SHEET_CONFIG.sections.reduce(
  (sum, s) => sum + s.items.length, 0
);

function countFilled(data: Record<string, Record<string, unknown>>): number {
  let count = 0;
  for (const section of NURSING_RECORD_SHEET_CONFIG.sections) {
    const sectionData = data[section.key] || {};
    for (const item of section.items) {
      const val = sectionData[item.key];
      if (val !== undefined && val !== null && val !== "") count++;
    }
  }
  return count;
}

export default definePlugin({
  id: "nursing-record",
  meta: { name: "护理记录", description: "填写护理检查单" },
  tab: {
    icon: ClipboardList,
    label: "护理记录",
    priority: 4,
    badge: (ctx) => {
      try {
        const raw = localStorage.getItem(`nursing_record_sheet_${ctx.recordId}`);
        const data = raw ? JSON.parse(raw) : {};
        const filled = countFilled(data);
        return { text: `${filled}/${TOTAL_ITEMS}`, variant: "default" };
      } catch { return null; }
    },
  },
  component: NursingRecordPanel,
});
```

- [ ] **Step 7: portrait/index.ts**

```typescript
import { Image } from "lucide-react";
import { definePlugin } from "@/engine/types";
import { PortraitTab } from "./PortraitTab";

export default definePlugin({
  id: "portrait",
  meta: { name: "患者立绘", description: "高级患者表情立绘" },
  tab: { icon: Image, label: "患者立绘", priority: 7 },
  component: PortraitTab,
});
```

- [ ] **Step 8: questionnaire/index.ts**

```typescript
import { definePlugin } from "@/engine/types";
import { QuestionnaireOverlay } from "./QuestionnaireOverlay";

export default definePlugin({
  id: "questionnaire",
  meta: { name: "问卷评估", description: "训练后评估问卷" },
  overlayComponent: QuestionnaireOverlay,
});

export { QuestionnaireOverlay };
```

- [ ] **Step 9: scoring-display/index.ts**

```typescript
import { definePlugin } from "@/engine/types";
import { ScoreCard } from "./ScoreCard";
import { ScoringOverlay } from "./ScoringOverlay";

export default definePlugin({
  id: "scoring-display",
  meta: { name: "评分展示", description: "训练评分和反馈" },
});

export { ScoreCard, ScoringOverlay };
```

- [ ] **Step 10: Commit**

```bash
git add frontend/src/plugins/emotion/index.ts frontend/src/plugins/initiative/index.ts frontend/src/plugins/physical-exam/index.ts frontend/src/plugins/patient-info/index.ts frontend/src/plugins/inquiry/index.ts frontend/src/plugins/nursing-record/index.ts frontend/src/plugins/portrait/index.ts frontend/src/plugins/questionnaire/index.ts frontend/src/plugins/scoring-display/index.ts
git commit -m "✨ feat: migrate all frontend plugins to definePlugin default export"
```

---

### Task 21: Frontend — Update TrainingEngine for manifest-driven rendering

**Files:**
- Modify: `frontend/src/engine/TrainingEngine.tsx`

- [ ] **Step 1: Rewrite TrainingEngineContent to remove manual plugin arrays**

Key changes:
1. Accept no `panelPlugins` prop
2. Use `discoverPluginDefs()` + `useManifest()` to build plugins
3. Wrap each tab component in `PluginErrorBoundary`
4. Include overlays from manifest (questionnaire, scoring)

```typescript
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChatArea } from "@/components/training/ChatArea";
import { PanelHost } from "@/components/training/PanelHost";
import { TrainingHeader } from "@/components/training/TrainingHeader";
import { PluginErrorBoundary } from "@/components/training/PluginErrorBoundary";
import { createMessageBus } from "./MessageBus";
import { PatientProvider, usePatient } from "./PatientProvider";
import type { EmotionState } from "./PluginContext";
import { EmotionProvider, PortraitProvider, useEmotion, usePortrait } from "./PluginContext";
import { pluginRegistry } from "./PluginRegistry";
import { ScoreManager } from "./ScoreManager";
import { StreamManager } from "./StreamManager";
import { TTSManager } from "./tts/TTSManager";
import { discoverPluginDefs } from "./discovery";
import { useManifest } from "./manifest";
import type { ChatMessage, FrontendPluginDef, PluginContext, PanelPlugin } from "./types";

interface TrainingEngineProps {
  recordId: string;
}

function buildPanelPlugin(def: FrontendPluginDef): PanelPlugin | null {
  if (!def.component || !def.tab) return null;
  return {
    id: def.id,
    meta: def.meta,
    tab: {
      icon: def.tab.icon as any,
      label: def.tab.label,
      badge: def.tab.badge,
      priority: def.tab.priority,
    },
    component: def.component,
    hooks: def.hooks,
  };
}

function TrainingEngineContent({ recordId }: TrainingEngineProps) {
  const {
    patient, loading: patientLoading, features: initialFeatures,
    fromAssignment, initialMessages, timeLimit, remainingSeconds,
  } = usePatient();
  const recordNum = Number(recordId);

  const busRef = useRef(createMessageBus());
  const streamRef = useRef(new StreamManager(recordNum));
  const scoreRef = useRef(new ScoreManager(recordNum, busRef.current));
  const ttsRef = useRef(new TTSManager({ autoPlay: true }));
  const cleanupRefs = useRef(new Map<string, (() => void) | undefined>());
  const seededRef = useRef(false);

  const { setEmotion } = useEmotion();
  const { setPortraitUrl } = usePortrait();

  useEffect(() => { ttsRef.current.attach(busRef.current); return () => ttsRef.current.detach(); }, []);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sending, setSending] = useState(false);
  const [ttsAutoPlay, setTtsAutoPlay] = useState(true);
  const [features, setFeatures] = useState<Record<string, boolean>>(initialFeatures);

  const { manifest } = useManifest(recordId);
  const localDefs = useMemo(() => discoverPluginDefs(), []);

  useEffect(() => { setFeatures(initialFeatures); }, [initialFeatures]);
  useEffect(() => {
    if (initialMessages.length > 0 && !seededRef.current) {
      seededRef.current = true;
      streamRef.current.setMessages(initialMessages);
    }
  }, [initialMessages]);
  useEffect(() => {
    streamRef.current.setRecordId(recordNum);
    const unsub = streamRef.current.subscribe(() => setMessages([...streamRef.current.getMessages()]));
    const unsubLoading = streamRef.current.onLoadingChange(setSending);
    return () => { unsub(); unsubLoading(); };
  }, [recordNum]);
  useEffect(() => { scoreRef.current.setRecordId(recordNum); return () => scoreRef.current.dispose(); }, [recordNum]);

  useEffect(() => {
    pluginRegistry.setFeatureFlags(features);
    if (manifest) pluginRegistry.setManifest(manifest);
    for (const def of localDefs) {
      const plugin = buildPanelPlugin(def);
      if (plugin) pluginRegistry.register(plugin);
    }
  }, [features, manifest, localDefs]);

  const activePlugins = useMemo(() => pluginRegistry.getActive(), [pluginRegistry.version]);

  const sendMessage = useCallback((text: string) => {
    const bus = busRef.current;
    streamRef.current.send(text, {
      onPatientChunk: () => bus.emit("stream:chunk"),
      onPatientDone: () => bus.emit("stream:done"),
      onError: (err) => bus.emit("stream:error", err),
      onExamResult: (examResult) => bus.emit("exam:result", examResult),
      onEmotionChange: (change) => bus.emit("emotion:changed", change),
      onInitiative: (initiative) => bus.emit("initiative:triggered", { content: initiative }),
    });
  }, []);

  const endTraining = useCallback(async () => {
    await scoreRef.current.end();
    busRef.current.emit("training:ended");
  }, []);

  const ctx: PluginContext = useMemo(() => ({
    recordId,
    bus: busRef.current,
    patient: patient!,
    messages,
    loading: sending,
    tts: { isAutoPlay: ttsAutoPlay, setAutoPlay: setTtsAutoPlay },
    sendMessage,
    endTraining,
  }), [recordId, patient, messages, sending, ttsAutoPlay, sendMessage, endTraining]);

  useEffect(() => {
    const cleanups = cleanupRefs.current;
    const activeIds = new Set(activePlugins.map((p) => p.id));
    for (const [id, cleanup] of cleanups) {
      if (!activeIds.has(id)) {
        if (typeof cleanup === "function") cleanup();
        cleanups.delete(id);
      }
    }
    for (const plugin of activePlugins) {
      if (cleanups.has(plugin.id)) continue;
      if (plugin.hooks?.onInit) {
        const cleanup = plugin.hooks.onInit(ctx);
        cleanups.set(plugin.id, cleanup);
      }
    }
  }, [activePlugins, ctx]);

  const [processedMessages, setProcessedMessages] = useState<ChatMessage[]>([]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let msgs = [...messages];
      for (const plugin of activePlugins) {
        if (plugin.hooks?.afterReceive) {
          const next: ChatMessage[] = [];
          for (const msg of msgs) {
            const result = plugin.hooks.afterReceive(msg, ctx);
            if (result instanceof Promise) {
              try { const resolved = await result; if (cancelled) return; if (resolved !== null) next.push(resolved); }
              catch { next.push(msg); }
            } else if (result !== null) { next.push(result); }
          }
          msgs = next;
        }
      }
      if (!cancelled) setProcessedMessages(msgs);
    })();
    return () => { cancelled = true; };
  }, [messages, activePlugins, ctx]);

  useEffect(() => {
    return busRef.current.on("emotion:changed", (data: { state: string }) => { setEmotion(data.state as EmotionState); });
  }, [setEmotion]);
  useEffect(() => {
    return busRef.current.on("portrait:changed", (data: { url: string }) => { setPortraitUrl(data.url); });
  }, [setPortraitUrl]);

  if (patientLoading) {
    return <div className="flex h-screen items-center justify-center"><div className="size-8 animate-spin rounded-full border-[3px] border-primary/30 border-t-primary" /></div>;
  }
  if (!patient) {
    return <div className="flex h-screen items-center justify-center text-muted-foreground">患者信息加载失败</div>;
  }

  const panelPluginsWrapped = activePlugins.map((p) => ({
    ...p,
    component: (props: any) => (
      <PluginErrorBoundary pluginName={p.meta.name}>
        <p.component {...props} />
      </PluginErrorBoundary>
    ),
  }));

  return (
    <>
      <div className="h-screen" style={{ display: "grid", gridTemplateAreas: '"header header" "content panel"', gridTemplateColumns: "1fr auto", gridTemplateRows: "auto 1fr" }}>
        <div style={{ gridArea: "header" }}>
          <TrainingHeader
            recordId={recordId} patient={patient} features={features}
            onToggleFeature={(key, enabled) => setFeatures((prev) => {
              const next = { ...prev, [key]: enabled };
              if (!enabled && key === "emotion") next.patient_initiative = false;
              return next;
            })}
            ttsAutoPlay={ttsAutoPlay} onTtsToggle={() => setTtsAutoPlay((v) => !v)}
            onEnd={endTraining} sending={sending} featuresLocked={fromAssignment}
            fromAssignment={fromAssignment} timeLimitMinutes={timeLimit}
            remainingSeconds={remainingSeconds}
          />
        </div>
        <div style={{ gridArea: "content", overflow: "hidden" }}>
          <ChatArea messages={processedMessages} patient={patient} sending={sending} onSend={sendMessage} bus={busRef.current} />
        </div>
        <div style={{ gridArea: "panel", overflow: "hidden" }}>
          <PanelHost ctx={ctx} features={features} plugins={panelPluginsWrapped} />
        </div>
      </div>
      {/* Overlay plugins rendered regardless of activePlugins since they use bus directly */}
      {localDefs.filter(d => d.id === "questionnaire").map(d => d.overlayComponent ? <d.overlayComponent key={d.id} recordId={recordId} bus={busRef.current} features={features} /> : null)}
      {localDefs.filter(d => d.id === "scoring-display").map(() => {
        const ScoreCardMod = require("@/plugins/scoring-display/ScoreCard");
        const ScoringOverlayMod = require("@/plugins/scoring-display/ScoringOverlay");
        return null; // handled below
      })}
    </>
  );
}
```

Wait — I should use proper imports, not `require()`. Let me simplify: keep the hardcoded overlays (`QuestionnaireOverlay`, `ScoringOverlay`, `ScoreCard`) for now since they're not panel plugins. They can be refactored later.

Revised approach: keep the three overlay components hardcoded in TrainingEngine, same as today. Only PanelHost is manifest-driven.

- [ ] **Step 2: Commit**

```bash
git add frontend/src/engine/TrainingEngine.tsx
git commit -m "♻️ refactor: TrainingEngine uses manifest-driven plugin rendering with ErrorBoundary"
```

---

### Task 22: Frontend — Simplify ChatTraining.tsx and AdminDebugPage.tsx

**Files:**
- Modify: `frontend/src/pages/ChatTraining.tsx`
- Modify: `frontend/src/pages/AdminDebugPage.tsx`

- [ ] **Step 1: Simplify ChatTraining.tsx**

```typescript
import { useParams } from "react-router-dom";
import { TrainingEngine } from "@/engine";

export default function ChatTraining() {
  const { recordId } = useParams<{ recordId: string }>();
  if (!recordId) return <div className="flex h-screen items-center justify-center">缺少训练记录 ID</div>;
  return <TrainingEngine recordId={recordId} />;
}
```

- [ ] **Step 2: Simplify AdminDebugPage.tsx**

```typescript
import { useParams } from "react-router-dom";
import { TrainingEngine } from "@/engine";

export default function AdminDebugPage() {
  const { recordId } = useParams<{ recordId: string }>();
  if (!recordId) return <div className="flex h-screen items-center justify-center">缺少训练记录 ID</div>;
  return <TrainingEngine recordId={recordId} />;
}
```

- [ ] **Step 3: Update engine/index.ts barrel export** — remove old PluginContext emotion-related exports if unused, add discovery.ts export. Check existing imports don't break.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/ChatTraining.tsx frontend/src/pages/AdminDebugPage.tsx
git commit -m "♻️ refactor: simplify page components — no manual plugin imports"
```

---

### Task 23: Frontend — Unit tests

**Files:**
- Create: `frontend/src/engine/__tests__/PluginRegistry.test.ts`
- Create: `frontend/src/engine/__tests__/MessageBus.test.ts`

- [ ] **Step 1: PluginRegistry tests**

```typescript
import { describe, it, expect } from "vitest";
import { PluginRegistry } from "../PluginRegistry";

function mockPlugin(id: string, priority = 0) {
  return {
    id,
    meta: { name: id },
    tab: { icon: () => null as any, label: id, priority },
    component: () => null as any,
  };
}

describe("PluginRegistry", () => {
  it("registers plugins", () => {
    const reg = new PluginRegistry();
    reg.register(mockPlugin("test"));
    expect(reg.getAll().length).toBe(1);
  });

  it("does not duplicate on re-register", () => {
    const reg = new PluginRegistry();
    reg.register(mockPlugin("test"));
    reg.register(mockPlugin("test"));
    expect(reg.getAll().length).toBe(1);
  });

  it("filters by manifest feature flag", () => {
    const reg = new PluginRegistry();
    reg.register(mockPlugin("a"));
    reg.register(mockPlugin("b"));
    reg.setManifest({
      plugins: [
        { id: "a", requires: [], feature_flag: "flag_a" },
        { id: "b", requires: [], feature_flag: undefined },
      ],
    });
    reg.setFeatureFlags({ flag_a: false });
    const active = reg.getActive();
    expect(active.map((p) => p.id)).toEqual(["b"]);
  });

  it("filters by manifest requires chain", () => {
    const reg = new PluginRegistry();
    reg.register(mockPlugin("base"));
    reg.register(mockPlugin("dependent"));
    reg.setManifest({
      plugins: [
        { id: "base", requires: [], feature_flag: "base_flag" },
        { id: "dependent", requires: ["base"], feature_flag: undefined },
      ],
    });
    reg.setFeatureFlags({ base_flag: false });
    const active = reg.getActive();
    expect(active.map((p) => p.id)).toEqual([]);

    reg.setFeatureFlags({ base_flag: true });
    expect(reg.getActive().map((p) => p.id)).toEqual(["base", "dependent"]);
  });

  it("sorts by priority", () => {
    const reg = new PluginRegistry();
    reg.register(mockPlugin("last", 10));
    reg.register(mockPlugin("first", 0));
    reg.setManifest({
      plugins: [
        { id: "first", requires: [], feature_flag: undefined },
        { id: "last", requires: [], feature_flag: undefined },
      ],
    });
    const active = reg.getActive();
    expect(active[0].id).toBe("first");
    expect(active[1].id).toBe("last");
  });
});
```

- [ ] **Step 2: MessageBus tests**

```typescript
import { describe, it, expect, vi } from "vitest";
import { createMessageBus } from "../MessageBus";

describe("MessageBus", () => {
  it("emits and receives events", () => {
    const bus = createMessageBus();
    const handler = vi.fn();
    bus.on("test", handler);
    bus.emit("test", 1, "hello");
    expect(handler).toHaveBeenCalledWith(1, "hello");
  });

  it("unsubscribe works", () => {
    const bus = createMessageBus();
    const handler = vi.fn();
    const unsub = bus.on("test", handler);
    unsub();
    bus.emit("test", 1);
    expect(handler).not.toHaveBeenCalled();
  });

  it("off removes handler", () => {
    const bus = createMessageBus();
    const handler = vi.fn();
    bus.on("test", handler);
    bus.off("test", handler);
    bus.emit("test", 1);
    expect(handler).not.toHaveBeenCalled();
  });

  it("multiple handlers for same event", () => {
    const bus = createMessageBus();
    const h1 = vi.fn();
    const h2 = vi.fn();
    bus.on("test", h1);
    bus.on("test", h2);
    bus.emit("test", 42);
    expect(h1).toHaveBeenCalledWith(42);
    expect(h2).toHaveBeenCalledWith(42);
  });

  it("listEvents returns registered events", () => {
    const bus = createMessageBus();
    bus.on("a", () => {});
    bus.on("b", () => {});
    expect(bus.listEvents()).toEqual(expect.arrayContaining(["a", "b"]));
  });
});
```

- [ ] **Step 3: Run frontend tests**

```bash
cd frontend && npx vitest run src/engine/__tests__/
```

Expected: All PASS

- [ ] **Step 4: Commit**

```bash
git add frontend/src/engine/__tests__/
git commit -m "✅ test: add PluginRegistry and MessageBus unit tests"
```

---

### Task 24: Full verification — lint, typecheck, backend tests

**Files:**
- None

- [ ] **Step 1: Run backend lint**

```bash
cd backend && ruff check . && ruff format --check .
```

Fix any issues.

- [ ] **Step 2: Run backend type checker**

```bash
cd backend && ty .
```

Fix any issues.

- [ ] **Step 3: Run backend unit tests**

```bash
cd backend && pytest -m "not pg" -v
```

Expected: All PASS, including `test_plugin_system.py`.

- [ ] **Step 4: Run frontend lint**

```bash
cd frontend && npx biome lint src/
```

Fix any issues.

- [ ] **Step 5: Run frontend typecheck**

```bash
cd frontend && npx tsc --noEmit
```

Fix any issues.

- [ ] **Step 6: Run frontend tests**

```bash
cd frontend && npx vitest run
```

Expected: All PASS.

- [ ] **Step 7: Run full check**

```bash
npm run check
```

Expected: All pass.

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "✅ test: full verification pass — lint + typecheck + tests"
```
