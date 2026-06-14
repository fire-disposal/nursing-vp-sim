# Plugin System Rewrite — Handoff Document

> 输出日期: 2026-06-14 | 当前分支: master @ 8057b35

---

## 一、当前状态

### 1.1 项目中的插件数量

| 插件 ID | 中文名 | Feature Flag | 依赖 | 后端作用 | 前端 UI |
|---------|--------|-------------|------|----------|---------|
| `emotion` | 患者情绪状态机 | `emotion` | 无 | middleware 分类学生意图 → 更新 2D 情绪模型 → 注入 author_note + SSE 事件 | EmotionTab 展示 |
| `initiative` | 患者主动回复 | `patient_initiative` | `emotion` | on_record_create 启动定时器 → side_effects 重置 | InitiativeTab 轮询 |
| `physical-exam` | 护理查体锚点交互 | `physical_exam` | 无 | 独立 POST endpoint，结果写 `practice_snapshot._exam_results` | ExamPanel 触发操作 |
| `exam-emotion-bridge` | 查体-情绪联动 | `exam_emotion_bridge` | `emotion`, `physical_exam` | on_exam 钩子修改 trust/comfort，写 `_exam_impact_note` | 无 UI |
| `portrait` | 患者立绘 | `portrait` | `emotion` | 无后端逻辑 | PortraitTab |
| `questionnaire` | 问卷评估 | `questionnaire` | 无 | 无后端逻辑 | QuestionnaireOverlay (独立 overlay) |
| `inquiry` | 必问清单 | 无 (常驻) | 无 | 无后端逻辑 | InquiryTab |
| `nursing-record` | 护理记录 | 无 (常驻) | 无 | 无后端逻辑 | NursingRecordPanel |

### 1.2 关键文件

```
backend/
  contexts/training/
    pipeline/
      plugin.py           ← Plugin dataclass, 全局 _registry, get_active_plugins(), run_plugin_hooks()
      registry.py         ← build_pipeline() 组装 [phase_guard] + plugin_mws + [phase_transition, ...]
      runner.py           ← run_pipeline() / stream_pipeline() 中间件链执行器
      context.py          ← PipelineContext dataclass（共享状态）
      middleware/
        emotion_tracker.py ← 唯一由插件提供的中间件（emotion 插件）
        prompt_builder.py  ← 收集 author_note + 构建 LLM messages（读 ctx.state）
        llm_caller.py      ← 调用 LLM
        persister.py       ← 保存消息到 DB
        phase_guard.py     ← 阶段校验
        phase_transition.py← 阶段自动推进
        side_effects.py    ← 回复后副作用（重置 initiative 定时器）
      phase.py            ← Phase 模型
    plugins.py            ← 4 个后端插件实例定义 + register_all_plugins()
    router/
      chat.py             ← POST /message → get_pipeline() → run_pipeline()
      session.py          ← 开始训练 → on_record_create hook
      progress.py         ← 查体操作 → on_exam hook
      scoring.py          ← 结束训练 → on_end hook

  core/
    feature_flags.py      ← 7 个 FeatureFlag 定义 + resolve_features() + is_enabled()

  main.py                 ← lifespan 中调用 register_all_plugins()

frontend/src/
  engine/
    types.ts              ← PanelPlugin / PluginContext / PluginHooks / PanelTabProps 类型
    PluginRegistry.ts     ← 前端插件注册表（Map + getActive + feature_flag 过滤）
    TrainingEngine.tsx    ← 注册 panelPlugins → PluginRegistry → 生命周期 → PanelHost
    PluginContext.tsx     ← EmotionProvider / PortraitProvider
    MessageBus.ts         ← 类型化事件总线
  plugins/
    emotion/              ← index.ts (definePlugin) + EmotionTab.tsx
    initiative/           ← index.ts + InitiativeTab.tsx（5s 轮询 /state）
    physical-exam/        ← index.ts + ExamPanel.tsx
    patient-info/         ← index.ts + PatientInfoTab.tsx
    inquiry/              ← index.ts + InquiryTab.tsx
    nursing-record/       ← index.ts + NursingRecordPanel.tsx + items/ (9 个子组件)
    portrait/             ← index.ts + PortraitTab.tsx
    questionnaire/        ← index.ts + QuestionnaireOverlay.tsx
    scoring-display/      ← ScoreCard.tsx + ScoringOverlay.tsx
  pages/
    ChatTraining.tsx      ← 手动 import 6 个插件 → 组装 panelPlugins 数组
    AdminDebugPage.tsx    ← 同上 + portraitPlugin (7 个)
```

---

## 二、核心缺陷清单

### 后端

| # | 缺陷 | 位置 | 严重度 |
|---|------|------|--------|
| 1 | **middleware 类型破损** — `plugin.py` 定义 `Callable[..., Awaitable[Any]]`，`runner.py` 定义 `Callable[[PipelineContext, Callable], Awaitable[None]]`，两个冲突 | `plugin.py:6` vs `runner.py:11` | 高 |
| 2 | **钩子同步但操作 DB** — `run_plugin_hooks()` 同步调用 `hook(ctx)`，但 `on_exam` 钩子直接修改 `record.practice_snapshot`（JSONB ORM 字段），无 db session 管理 | `plugin.py:86` → `plugins.py:123-125` | 高 |
| 3 | **钩子上下文是 ad-hoc dict** — 每个调用点自己拼上下文（`_hook_ctx`、内联 exam_ctx），无类型、无文档 | `plugins.py:8-9`, `progress.py:286` | 高 |
| 4 | **全局可变 _registry** — 模块级 dict，无 reset/context manager，测试无法隔离 | `plugin.py:35` | 中 |
| 5 | **on_phase_change / on_score 死代码** — 在 `PipelinePlugin` 中定义但整个代码库零次调用 | `plugin.py:29,32` | 中 |
| 6 | **中间件无优先级/排序** — 所有插件 middleware 堆在同一位置（phase_guard 后、phase_transition 前），无法指定阶段 | `registry.py:28` | 中 |
| 7 | **feature_flag 名与 plugin_id 名无强制一致** — 依赖通过 `requires=["emotion"]`（plugin_id），活跃性通过 `feature_flag="emotion"`（flag 名），目前恰同名但无保证 | `plugins.py` | 中 |
| 8 | **`_exam_results` / `_exam_impact_note` 泄露到 DB** — 下划线前缀的"内部状态"直接持久化到 `practice_snapshot` JSONB 字段 | `plugins.py:123-125`, `prompt_builder.py:33-44` | 低 |
| 9 | **注册无自动发现** — `register_all_plugins()` 手动枚举 4 个实例，新增插件必须修改此函数 | `plugins.py:175-177` | 低 |

### 前端

| # | 缺陷 | 位置 | 严重度 |
|---|------|------|--------|
| 10 | **插件注册散落在各页面** — `ChatTraining.tsx` 手动列 6 个、`AdminDebugPage.tsx` 手动列 7 个 | `ChatTraining.tsx:14-23` | 高 |
| 11 | **无插件级错误边界** — 单插件组件崩溃 → 整个 TrainingEngine 白屏 | `TrainingEngine.tsx` | 高 |
| 12 | **MessageBus 类型擦除** — `emit(event: string, ...args: any[])`，event 是 string，args 是 any | `types.ts:46` | 低 |
| 13 | **前后端无共享常量** — `"emotion"` / `"physical_exam"` 等字符串在 Python 和 TypeScript 中各出现一份 | — | 低 |

### 跨层

| # | 缺陷 | 严重度 |
|---|------|--------|
| 14 | 插件有三种注入方式（middleware / lifecycle hook / 独立 endpoint），新开发者不知道该用哪种 | 中 |
| 15 | 无插件作者文档或范式指南 | 低 |

---

## 三、已确认的设计决策

以下决定已在讨论中确认，重写时不可推翻：

### Decision 1: 协议级重构 + 全栈统一
- 不是修 bug，而是重新设计插件协议和生命周期
- 前后端都需要感知每个插件的存在

### Decision 2: 声明式能力路由
- 每个插件是一份自描述清单，声明自己的"能力"
- 框架根据能力声明自动决定如何注入（中间件位置、路由注册、钩子调用）
- 插件作者不需要知道 pipeline 内部顺序细节

### Decision 3: 后端驱动前端
- 插件在后端 Python 中定义为唯一真相源
- 前端通过 `GET /api/plugins/manifest` 拉取 manifest JSON
- 前端根据 manifest 自动渲染 tab / badge / 组件（不再手动 import 和组装数组）

### Decision 4: 类继承协议 (方案 A)
- 插件是 `Plugin` 抽象基类的子类
- 通过覆写方法声明能力（`get_middleware()`, `on_training_end()`, `ui_manifest()` 等）
- 发现机制：`Plugin.__subclasses__()` 或显式 import 集中注册

### Decision 5: 全量迁移（基础设施 + 8 个插件）
- 不保留旧代码并行运行
- 所有现有插件一并迁移到新范式

### Decision 6: 不纳入 Prompt/AI 核心
- 本次重写不触及 `prompt_builder.py`、PromptManager、提示词模板系统
- 这些留给独立的"AI 核心重构"任务

---

## 四、遗留设计问题（需在新进程中决定）

1. **插件目录结构**：`backend/plugins/<name>/` 还是平铺在 `contexts/training/plugins.py`？
2. **生命周期钩子如何异步化**：每个钩子签名是什么？是否需要 db session 参数？
3. **中间件排序**：声明 `pipeline_stage`（如 `"pre_prompt"` / `"post_llm"`）还是声明 `before=["prompt_builder"]`？
4. **独立 endpoint 如何声明式注册**：插件 override `register_routes(router: APIRouter)` 还是装饰器？
5. **Feature flag 定义是否也移到各插件模块**：目前集中在 `core/feature_flags.py`，是否改为插件自带 flag 定义？
6. **前端 manifest 包含哪些信息**：tab 图标名？badge 逻辑？组件 key？
7. **前端如何从 manifest 映射到 React 组件**：`componentId` 字符串 → 中央 `componentMap` 还是动态 import？
8. **MessageBus 类型化**：是否在此次一并修复？
9. **测试策略**：新插件系统需要哪些测试（单元 / 集成 / E2E）？

---

## 五、重构原则

- **功能不减少**：8 个现有插件的能力必须全部保留
- **不影响训练主流程**：chat message → LLM reply 的 round-trip 必须与现有一致
- **不影响数据库 schema**：不修改 `practice_snapshot` 的读写位置（schema 改动留给后续迁移）
- **向后兼容 API**：前端 API 路径和响应格式尽量不变（manifest endpoint 是新增）
- **遵循现有 convention**：import 风格、日志、错误处理与项目一致
