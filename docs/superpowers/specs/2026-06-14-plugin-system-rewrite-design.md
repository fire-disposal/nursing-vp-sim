# Plugin System Rewrite — Design Spec

> 日期: 2026-06-14 | 基于 handoff: `2026-06-14-plugin-system-rewrite-handoff.md`

---

## 一、目标

全局重构插件系统，修复 15 个已知缺陷，统一前后端插件协议，实现**声明式能力路由**和**后端驱动前端**。

### 非目标

- 不重构 prompt_builder / PromptManager / 提示词模板系统（留给 AI 核心重构）
- 不修改数据库 schema
- 不修改旧版 pipeline 中间件的内部实现（只重排组装方式）

---

## 二、核心设计决策

### D1: 后端为唯一真相源

每个插件是 `Plugin` 抽象基类的子类，定义在 `backend/plugins/<name>/plugin.py`。插件声明自己的全部能力（中间件、路由、钩子、feature flag、前端 UI manifest）。前端通过 `GET /api/plugins/manifest` 获取信息并自动渲染。

### D2: 前端自动发现 + manifest 激活

- **Vite `import.meta.glob`** 自动收集 `frontend/src/plugins/*/index.ts` 下所有插件，无需手动 import
- **后端 manifest** 决定"激活哪些"（基于 feature flag + requires 依赖链）
- `ChatTraining.tsx` 和 `AdminDebugPage.tsx` 不再手动列插件数组

### D3: 声明式能力路由

插件通过覆写方法声明能力，框架自动：
- 将中间件安插到正确的 pipeline stage
- 注册路由到 FastAPI
- 在生命周期节点调用对应钩子
- 将 UI manifest 合并输出到 API

### D4: 全量迁移

所有 8 个现有插件一并迁移到新范式。不保留旧代码并行运行。

---

## 三、后端设计

### 3.1 目录结构

```
backend/
  plugins/
    __init__.py
    base.py                  # Plugin ABC, PipelineStage, RouteDef, 上下文类型
    manager.py               # PluginManager（注册、发现、生命周期、manifest 生成）
    manifest.py              # ManifestResponse 模型 + /api/plugins/manifest 路由
    emotion/                 # EmotionPlugin
      plugin.py
      middleware.py           # emotion_tracker
    initiative/              # InitiativePlugin
      plugin.py
    physical-exam/           # PhysicalExamPlugin
      plugin.py
      routes.py               # perform_exam handler
    exam-emotion-bridge/     # ExamEmotionBridgePlugin
      plugin.py

  core/
    feature_flags.py          # 只保留非插件 flag（如 allow_pause）
```

### 3.2 Plugin 基类

```python
class Plugin(ABC):
    """所有插件的抽象基类。覆写方法 = 声明能力。"""

    # ── 身份（必须覆写）──
    id: ClassVar[str]
    name: ClassVar[str]
    description: ClassVar[str] = ""
    requires: ClassVar[list[str]] = []     # 依赖插件 ID 列表

    # ── Feature Flag ──
    feature_flag: ClassVar[FeatureFlag | None] = None

    # ── 能力声明 ──

    def get_middleware(self) -> list[tuple[PipelineStage, MiddlewareFunc]]:
        """返回 [(阶段, 中间件函数), ...]"""
        return []

    def get_routes(self) -> list[RouteDef]:
        """返回声明式路由列表"""
        return []

    # ── 生命周期钩子 ──

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

    # ── 前端 Manifest ──

    def ui_manifest(self) -> UIManifest | None:
        return None

    # ── Author's Note 贡献（预留，本次不实现）──

    def author_note(self, ctx) -> str | None:
        return None
```

### 3.3 PipelineStage 枚举

```python
class PipelineStage(str, Enum):
    GUARD = "guard"
    PLUGIN_EARLY = "plugin_early"     # 插件中间件默认位置
    TRANSITION = "transition"
    PROMPT = "prompt"
    LLM = "llm"
    PERSIST = "persist"
    SIDE_EFFECTS = "side_effects"
```

框架内部维护 `_STAGE_ORDER: dict[PipelineStage, int]`。`get_pipeline()` 按 stage order 排列所有中间件。

### 3.4 上下文类型（替代 ad-hoc dict）

```python
@dataclass
class RecordCreateContext:
    record: TrainingRecord
    emotion_cache: EmotionCache
    initiative_cache: InitiativeCache

@dataclass
class ExamContext:
    record: TrainingRecord
    emotion_cache: EmotionCache
    op_type: str
    explanation_given: bool
    exam_count: int

@dataclass
class ExamEffect:
    """on_exam 返回的副作用声明，由框架执行"""
    snapshot_updates: dict = field(default_factory=dict)   # 写入 practice_snapshot
    emotion_delta: tuple[int, int] | None = None           # (trust_delta, comfort_delta)
    history_event: dict | None = None

@dataclass
class EndContext:
    record: TrainingRecord
    emotion_cache: EmotionCache
    initiative_cache: InitiativeCache

@dataclass
class PhaseChangeContext:
    record: TrainingRecord
    from_phase: str
    to_phase: str
```

### 3.5 RouteDef

```python
@dataclass
class RouteDef:
    method: str                              # "GET" | "POST" | "PUT" | "DELETE"
    path: str                                # "/{record_id}/exam/{op_type}"
    handler: Callable                        # FastAPI handler 函数
    response_model: type | None = None
    tags: list[str] = field(default_factory=lambda: ["plugin"])
```

框架在 `main.py` lifespan 中遍历所有插件的 `get_routes()`，统一 `router.add_api_route()`。

### 3.6 PluginManager

```python
class PluginManager:
    """管理所有插件的注册、发现、生命周期调用和 manifest 生成。"""

    def __init__(self):
        self._plugins: dict[str, Plugin] = {}

    def register(self, plugin: Plugin) -> None:
        ...

    def discover(self) -> None:
        """自动发现 Plugin.__subclasses__() 并注册。替代手动 register_all_plugins()。"""

    def get_active(self, feature_flags: dict[str, bool]) -> list[Plugin]:
        """返回满足 feature flag + requires 依赖的活跃插件列表。"""

    def run_hook(self, hook_name: str, ctx, feature_flags: dict[str, bool]) -> None:
        """异步调用所有活跃插件的指定钩子。"""

    def build_pipeline(self, feature_flags: dict[str, bool]) -> list:
        """按 PipelineStage 顺序排列 core + plugin 中间件。"""

    def generate_manifest(self, feature_flags: dict[str, bool]) -> ManifestResponse:
        """聚合所有活跃插件的 ui_manifest() 输出。"""

    def register_routes(self, router: APIRouter) -> None:
        """将所有活跃插件的 get_routes() 注册到给定 router。"""
```

### 3.7 Feature Flag 迁移

- 非插件 flag（`allow_pause`）保留在 `core/feature_flags.py`
- 每个插件在自己的模块中定义 `feature_flag` classvar（可选）
- `PluginManager` 聚合所有 feature flag 定义，供前端 manifest 和后端 resolve 使用
- **功能不变**：`resolve_features()` 和 `is_enabled()` 行为不变

### 3.8 Manifest API

```
GET /api/plugins/manifest

Response:
{
  "plugins": [
    {
      "id": "emotion",
      "name": "患者情绪状态机",
      "feature_flag": "emotion",
      "requires": [],
      "ui": {
        "type": "panel",
        "tab": {
          "icon": "Smile",
          "label": "情绪状态",
          "priority": 5
        }
      }
    },
    {
      "id": "physical-exam",
      "name": "护理查体锚点交互",
      "feature_flag": "physical_exam",
      "requires": [],
      "ui": {
        "type": "panel",
        "tab": {
          "icon": "Stethoscope",
          "label": "护理查体",
          "priority": 3,
          "badge": "exam_progress"
        },
        "actions": [
          {"id": "exam_bp", "label": "血压测量", "type": "exam", "op_type": "bp"}
        ]
      }
    }
  ],
  "feature_flags": {
    "emotion": {"key": "emotion", "label": "患者情绪状态机", "default": false},
    ...
  }
}
```

注意：前端 manifest 只描述 UI 结构，不包含 React 组件引用。前端通过 `id` 匹配本地 glob 发现的组件。

### 3.9 中间件签名统一

修复缺陷 #1。统一使用 `runner.py` 中定义的签名：

```python
PipelineMiddleware = Callable[
    [PipelineContext, Callable[[], Awaitable[None]]],
    Awaitable[None],
]
```

`plugin.py` 中的 `PipelineMiddleware = Callable[..., Awaitable[Any]]` 删除。

### 3.10 钩子异步化 + DB 管理

修复缺陷 #2。`on_exam` 钩子**不直接操作 `record.practice_snapshot`**。改为返回 `ExamEffect`，由框架在 DB session 内写入。

调用链路：
```
perform_exam endpoint
  → handle_operation() 写入 _exam_results
  → PluginManager.run_hook("on_exam", exam_ctx, features)
    → 收集 ExamEffect 列表
  → 框架合并 ExamEffect 到 record.practice_snapshot + emotion cache
  → db.commit()
```

---

## 四、前端设计

### 4.1 目录结构

```
frontend/src/
  engine/
    types.ts              # PluginProtocol (对齐后端 manifest), PluginContext, ...
    PluginRegistry.ts     # 注册表（不变）
    manifest.ts           # fetchManifest() + useManifest() hook
    discovery.ts          # import.meta.glob 自动发现所有插件模块
    TrainingEngine.tsx    # 根据 manifest 渲染（不再手动列插件）
    MessageBus.ts         # 类型化泛型总线
    PluginContext.tsx     # EmotionProvider + PortraitProvider（不变）
    ...

  plugins/
    emotion/
      index.ts            # export default definePlugin({...})
      EmotionTab.tsx
    initiative/
      index.ts
      InitiativeTab.tsx
    physical-exam/
      index.ts
      ExamPanel.tsx
    patient-info/
      index.ts
      PatientInfoTab.tsx
    inquiry/
      index.ts
      InquiryTab.tsx
    nursing-record/
      index.ts
      NursingRecordPanel.tsx
      items/...
    portrait/
      index.ts
      PortraitTab.tsx
    questionnaire/
      index.ts
      QuestionnaireOverlay.tsx
    scoring-display/
      index.ts
      ScoreCard.tsx
      ScoringOverlay.tsx

  pages/
    ChatTraining.tsx      # 简化为 <TrainingEngine recordId={recordId} />
    AdminDebugPage.tsx    # 同上（manifest 已包含 portrait 所需信息）
```

### 4.2 前端插件定义（definePlugin）

```typescript
// frontend/src/plugins/emotion/index.ts
import { Smile } from "lucide-react";
import EmotionTab from "./EmotionTab";

export default definePlugin({
  id: "emotion",
  meta: { name: "情绪状态", description: "患者情绪状态机追踪" },
  tab: { icon: "Smile", label: "情绪状态", priority: 5 },
  component: EmotionTab,
});
```

`definePlugin` 是身份函数（提供类型推导），返回 `FrontendPlugin` 对象。不再 need manual feature flag / requires（这些由后端 manifest 提供）。

### 4.3 自动发现

```typescript
// frontend/src/engine/discovery.ts
const pluginModules = import.meta.glob("@/plugins/*/index.ts", { eager: true });

export function discoverPlugins(): FrontendPlugin[] {
  return Object.values(pluginModules)
    .filter((m: any) => m.default && m.default.id)
    .map((m: any) => m.default);
}
```

### 4.4 TrainingEngine 简化

```typescript
function TrainingEngineContent({ recordId }: { recordId: string }) {
  // ... 现有逻辑（MessageBus、StreamManager、ScoreManager 等）...

  // 拉取后端 manifest
  const { manifest, loading: manifestLoading } = useManifest(recordId);

  // 自动发现本地插件
  const localPlugins = useMemo(() => discoverPlugins(), []);

  // 注册 + 激活
  useEffect(() => {
    if (!manifest) return;
    pluginRegistry.setFeatureFlags(manifest.feature_flags);
    for (const lp of localPlugins) {
      const mp = manifest.plugins.find(p => p.id === lp.id);
      if (mp) pluginRegistry.register(enrich(lp, mp));
    }
  }, [manifest, localPlugins]);

  const activePlugins = useMemo(
    () => pluginRegistry.getActive(),
    [pluginRegistry.version],
  );

  // ... 渲染（ChatArea + PanelHost + overlays 根据 manifest 决定）...
}
```

### 4.5 ChatTraining.tsx 和 AdminDebugPage.tsx 简化

```typescript
// ChatTraining.tsx — 不再手动 import 任何插件
export default function ChatTraining() {
  const { recordId } = useParams<{ recordId: string }>();
  if (!recordId) return <div>缺少训练记录 ID</div>;
  return <TrainingEngine recordId={recordId} />;
}

// AdminDebugPage.tsx — 同上
export default function AdminDebugPage() {
  const { recordId } = useParams<{ recordId: string }>();
  if (!recordId) return <div>缺少训练记录 ID</div>;
  return <TrainingEngine recordId={recordId} />;
}
```

frontend 和 admin debug 的区别仅在于 record 的 feature flag 配置不同（admin 可开更多 flag），manifest 自动反映。

### 4.6 MessageBus 类型化

```typescript
interface BusEvents {
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

class TypedMessageBus implements MessageBus {
  on<E extends keyof BusEvents>(event: E, handler: (...args: BusEvents[E]) => void): () => void;
  emit<E extends keyof BusEvents>(event: E, ...args: BusEvents[E]): void;
  off(event: string, handler: (...args: any[]) => void): void;
}
```

`TypedMessageBus` 兼容现有 `MessageBus` 接口。类型安全只在调用 `.on()/.emit()` 时生效。

### 4.7 错误边界

修复缺陷 #11。每个 tab 组件包裹 `<ErrorBoundary>`：

```typescript
function PluginTabWrapper({ plugin, ctx, features, isCollapsed }: Props) {
  return (
    <ErrorBoundary fallback={<TabErrorDisplay pluginName={plugin.meta.name} />}>
      <plugin.component ctx={ctx} features={features} isCollapsed={isCollapsed} />
    </ErrorBoundary>
  );
}
```

一个插件 tab 崩溃不会影响其他 tab 或主聊天区。

---

## 五、8 个插件迁移清单

| 插件 ID | 后端变化 | 前端变化 |
|---------|---------|---------|
| `emotion` | `EmotionPlugin` 子类；覆写 `get_middleware()` + `on_training_end()` + `ui_manifest()` | `definePlugin`；Tab 组件不变 |
| `initiative` | `InitiativePlugin` 子类；覆写 `on_record_create()` + `on_training_end()` + `ui_manifest()` | `definePlugin`；polling hook 不变 |
| `physical-exam` | `PhysicalExamPlugin` 子类；覆写 `get_routes()` + `ui_manifest()`（含 actions 列表） | `definePlugin`；ExamPanel 不变 |
| `exam-emotion-bridge` | `ExamEmotionBridgePlugin` 子类；覆写 `on_exam()` 返回 `ExamEffect` | 无 UI（无 `ui_manifest()`） |
| `portrait` | 无后端逻辑（`ui_manifest()` 只声明 tab） | `definePlugin`；PortraitTab 不变 |
| `questionnaire` | 无后端逻辑 | `definePlugin` 作为 overlay 类型；QuestionnaireOverlay 不变 |
| `inquiry` | 无后端逻辑 | `definePlugin`；InquiryTab 不变 |
| `nursing-record` | 无后端逻辑 | `definePlugin`；NursingRecordPanel 不变 |

### migration 中对原有行为的影响范围

- **pipeline 中间件顺序不变**（emotion_tracker 仍在 phase_guard 后、prompt 前）
- **API endpoint 路径不变**（`/api/chat/{record_id}/message` 等等）
- **practice_snapshot 读写位置不变**
- **前端体验不变**（同样的 tab、同样的交互）
- **变更的唯一外部可见行为**：新增 `GET /api/plugins/manifest` endpoint

---

## 六、测试策略

| 层级 | 测试内容 | 运行方式 |
|------|---------|---------|
| 单元 | `PipelineStage` 排序逻辑 | `pytest -m "not pg"` |
| 单元 | `PluginManager.register()` / `get_active()` / `generate_manifest()` | `pytest -m "not pg"` |
| 单元 | `Plugin` 子类覆写方法返回正确值 | `pytest -m "not pg"` |
| 单元 | `TypedMessageBus` 类型安全 | `vitest` |
| 集成 | `GET /api/plugins/manifest` 返回正确 JSON | `pytest -m pg` |
| 集成 | pipeline 中间件链包含插件中间件 | `pytest -m pg` |
| 集成 | `on_exam` 钩子写入 `ExamEffect` | `pytest -m pg` |
| 集成 | 前端 manifest → PluginRegistry → 渲染 | `vitest` |

---

## 七、实现顺序

1. **Phase 1 — Backend 基础设施**
   - `plugins/base.py`（Plugin ABC + PipelineStage + RouteDef + 上下文类型）
   - `plugins/manager.py`（PluginManager 完整实现）
   - `plugins/manifest.py`（ManifestResponse + manifest endpoint）
   - `plugins/__init__.py`（导出）
   - 修改 `core/feature_flags.py`（移出插件 flag）
   - 修改 `main.py`（用 PluginManager 替代 register_all_plugins）
   - 修改 `registry.py`（用 PluginManager.build_pipeline）

2. **Phase 2 — Backend 插件迁移**
   - `emotion/` 插件
   - `initiative/` 插件
   - `physical-exam/` 插件
   - `exam-emotion-bridge/` 插件
   - 删除旧的 `contexts/training/pipeline/plugin.py` 和 `contexts/training/plugins.py`
   - 修改调用点（chat.py, session.py, progress.py, scoring.py）改用 PluginManager

3. **Phase 3 — Frontend 基础设施**
   - 更新 `types.ts`（FrontendPlugin/Manifest 类型）
   - `discovery.ts`（vite glob 自动发现）
   - `manifest.ts`（fetchManifest + useManifest）
   - 更新 `PluginRegistry.ts`（支持 manifest 数据合并）
   - `MessageBus.ts` 类型化
   - `ErrorBoundary` 组件
   - 更新 `TrainingEngine.tsx`（manifest 驱动渲染）

4. **Phase 4 — Frontend 插件迁移**
   - 所有 8 个插件改为 `definePlugin` 导出
   - 简化 `ChatTraining.tsx` 和 `AdminDebugPage.tsx`
   - 迁移 plugin hooks 到 definePlugin

5. **Phase 5 — 测试 & 清理**
   - 添加所有测试
   - `npm run check` 全量通过
   - 清理旧代码引用
