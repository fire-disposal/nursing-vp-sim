# 插件系统现状分析与演化方案

> 审查日期: 2026-06-17
> 审查范围: backend/plugins/ + frontend/src/plugins/ + 相关联核心模块
>
> **实施状态: ✅ 全部完成 — 2026-06-18**
>
> 所有演化步骤均已落地，详见变更日志:
> - `backend/plugins/` 目录已完全删除
> - `frontend/src/plugins/` 目录已完全删除
> - emotion/physical-exam 已吸收为核心 middleware/router
> - 前端面板组件统一在 `components/training/panels/` 下
> - PluginManager 已替换为 `pipeline.builder.build_pipeline()`

---

## 一、现有插件清单

| 插件 | 后端类 | 前端组件 | Feature Flag | 中间件 | 路由 | Hook | 核心逻辑位置 |
|---|---|---|---|---|---|---|---|
| **emotion** | ✅ | ✅ EmotionTab | `emotion` (default=false) | 1个 | ❌ | on_training_end | `contexts/patient/emotion.py` |
| **physical-exam** | ✅ | ✅ ExamPanel | `physical_exam` (default=false) | ❌ | POST /exam/{type} | ❌ | `contexts/patient/exam.py` |
| **nursing-record** | ✅ (空壳) | ✅ NursingRecordPanel | ❌ | ❌ | ❌ | ❌ | 仅前端 |
| **questionnaire** | ✅ (空壳) | ✅ QuestionnaireOverlay | ❌ | ❌ | ❌ | ❌ | 仅前端 |
| **scoring-display** | ❌ | ✅ ScoringDisplay | ❌ | ❌ | ❌ | ❌ | 仅前端 |
| **patient-info** | ❌ | ✅ PatientInfoTab | ❌ | ❌ | ❌ | ❌ | 仅前端 |
| **initiative** | ❌ | ✅ InitiativeTab | `patient_initiative` (核心flag) | ❌ | ❌ | ❌ | `contexts/patient/initiative.py` |
| **inquiry** | ❌ | ✅ InquiryTab | ❌ | ❌ | ❌ | ❌ | 仅前端 |

---

## 二、腐化诊断

### 2.1 插件空壳化

`nursing-record`、`questionnaire` 的 `backend/plugins/*/plugin.py` 只包含一行 `Plugin` 子类定义：

```python
class NursingRecordPlugin(Plugin):
    id = "nursing-record"
    name = "护理记录"
    description = "结构化护理记录单"
    def ui_manifest(self) -> UIManifest:
        return UIManifest(type="panel", tab=...)
```

无后端逻辑、无中间件、无路由。本质是 **UI 组件注册表条目**，不是"插件"。

### 2.2 核心逻辑已先行内建，插件仅薄壳

- `contexts/patient/emotion.py` — 独立的 2D 情绪状态机，`emotion_tracker` middleware 仅负责调用它 + 写缓存
- `contexts/patient/exam.py` — 独立的查体操作引擎，`physical_exam` 插件仅封装路由 + 情绪联动
- `contexts/patient/initiative.py` — 完整的主动追问引擎，**没有对应的后端插件类**

### 2.3 前端 EmotionProvider 已嵌入核心渲染树

```tsx
// TrainingEngine.tsx
<EmotionProvider>
  <PortraitProvider>
    <TrainingEngineContent />
  </PortraitProvider>
</EmotionProvider>
```

`EmotionProvider` 是 TrainingEngine 的外层 Provider，**非插件动态加载**。插件仅消费其 context，不管理其生命周期。

### 2.4 Feature Flag 归属混乱

- `exam_emotion_bridge` — 定义在 `core/feature_flags.py`（核心层）
- `emotion` — 定义在 `plugins/emotion/plugin.py`（插件层）
- `patient_initiative` — 定义在 `core/feature_flags.py`（核心层）

但 physical-exam 的情绪联动代码同时检查 `exam_emotion_bridge && emotion`，导致功能边界跨层耦合。

### 2.5 PluginManager 运行时扫描脆弱

```python
# manager.py
def _all_plugin_classes() -> list[type]:
    for entry in sorted(plugin_dir.iterdir()):
        if not entry.is_dir(): continue
        mod = importlib.import_module(f"plugins.{entry.name}.plugin")
```

- 约定大于配置，目录名即插件 ID
- 缺少显式注册表，模块缺失时静默失败
- 每处调用 `get_plugin_manager()` 都需要再次 `discover()`

---

## 三、插件机制的真正价值

经过审查，三个抽象值得保留：

| 机制 | 位置 | 价值评估 |
|---|---|---|
| **Pipeline middleware 注入** | `backend/plugins/base.py` → PipelineStage | 允许在核心流程中插队，架构上合理的扩展点 |
| **NoteSource + NoteCollector** | `backend/contexts/patient/note_source.py` + `note_collector.py` | 插件向 LLM 上下文注入额外信息的抽象，真正的扩展点 |
| **前端 PluginRegistry** | `frontend/src/engine/PluginRegistry.ts` | Tab/Overlay 注册与 feature-flag 管控，抽象本身有价值 |

---

## 四、演化方案

### Step 1 — 吸收为内置特性

#### 1a. emotion
| 现在 | 未来 |
|---|---|
| `backend/plugins/emotion/plugin.py` → 插件类 | 拆除 |
| `backend/plugins/emotion/middleware.py` → emotion_tracker | 升格为 core pipeline middleware，位置 `contexts/training/pipeline/middleware/` |
| `frontend/src/plugins/emotion/` → 前端组件 | 注册方式从 `PluginRegistry.register()` 改为直接在 PanelHost 中声明 |
| `PluginContext.tsx` EmotionProvider | 保留，但不再通过插件协议加载 |

#### 1b. physical-exam
| 现在 | 未来 |
|---|---|
| `backend/plugins/physical_exam/plugin.py` → 插件类 | 拆除 |
| `backend/plugins/physical_exam/routes.py` → perform_exam | 路由直接挂到 `training_router` 或 `nursing_router` |
| `frontend/src/plugins/physical-exam/` → 前端组件 | 直接声明为内置面板 |

#### 1c. 纯前端面板 (nursing-record / questionnaire / patient-info / initiative / inquiry / scoring-display)
| 现在 | 未来 |
|---|---|
| `backend/plugins/*/plugin.py` (空壳) | 拆除 |
| `frontend/src/plugins/*/` → 前端组件 | 直接声明为内置面板，PluginRegistry 仅作为 UI 注册机制保留 |

#### 1d. Feature Flag 合并
- `emotion` 与 `exam_emotion_bridge` 合并为一个 flag `emotion`（开启 emotion 即开启情绪联动）
- `patient_initiative` 保留为核心 flag
- `physical_exam` 保留为独立 flag

### Step 2 — 精简插件协议层

```
                                   ┌──────────────────────────────┐
                                   │        内置特性系统            │
                                   │  (所有现有插件吸收后)          │
                                   │                              │
                                   │  emotion (core middleware)    │
                                   │  physical-exam (core route)   │
                                   │  initiative (core module)     │
                                   │  nursing-record (前端组件)    │
                                   │  questionnaire (前端组件)     │
                                   │  patient-info (前端组件)      │
                                   │  scoring-display (前端组件)   │
                                   │  inquiry (前端组件)           │
                                   └──────────┬───────────────────┘
                                              │
                    ┌─────────────────────────┴─────────────────────────┐
                    │                扩展层 (保留/精简)                  │
                    │                                                   │
                    │  PluginRegistry (前端 Tab/Overlay 注册表)         │
                    │  NoteSource 抽象类 (后端 LLM 上下文注入)          │
                    │  pipeline middleware stage (框架抽象保留)          │
                    └───────────────────────────────────────────────────┘
```

#### 具体操作

1. **拆除** `backend/plugins/` 目录中所有 `plugin.py` → 减少约 800 行代码
2. **迁移** `emotion_tracker` 至 `contexts/training/pipeline/middleware/`
3. **迁移** `perform_exam` 路由至 `routers/` 或 `contexts/training/router/`
4. **集中** frontend 面板注册到 `TrainingEngine.tsx` 或一个显式清单文件，不再依赖 `import.meta.glob` 扫描
5. **保留** `PluginRegistry.ts` 作为 UI 注册抽象（未来第三方扩展用）
6. **保留** `NoteSource` + `NoteCollector` 架构
7. **保留** `PipelineStage` 枚举 + middleware chain 编排逻辑

---

## 五、影响评估

| 维度 | 变化 |
|---|---|
| 后端代码行数 | -~800 行 (backend/plugins/) |
| 前端代码行数 | +~100 行 (显式注册) |
| 行为变更 | 无 — 现有 feature flag 保持一致，UI 不变 |
| 可测试性 | ↑ — 移除 importlib 运行时扫描，依赖更显式 |
| 可扩展性 | ↑ — 核心抽象保留，但不再有人为的"插件"层级 |

---

## 六、后续操作指引

建议按顺序合入：

1. **PR 1**: emotion 吸收 — 迁移 middleware，拆除插件类 (+ 本报告)
2. **PR 2**: physical-exam 吸收 — 迁移路由，拆除插件类
3. **PR 3**: 前端面板集中注册 + 拆除空壳插件类
4. **PR 4**: feature flag 合并 + PluginManager 简化
