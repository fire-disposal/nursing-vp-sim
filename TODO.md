# 训练架构重构 TODO

> 2026-06-29 · 从 `TRAINING-ARCH-MEMO.md` 拆出的实施批次

## 批次 A — Profile 基础设施 + Case 解耦（~3 天）

目标：建立 profile 注册机制，Case 解绑单 schema，现有代码通过适配层继续工作。

- [ ] 定义 `TrainingProfile` / `PromptCollection` / `PhaseConfig` 数据类 (`profiles/__init__.py`)
- [ ] 建立注册中心 `get_profile(type)` (`profiles/registry.py`)
- [ ] 搬迁 `history_taking` 现有配置到 profile (`profiles/history_taking/profile.py`)
- [ ] 数据自描述：`infer_operations(case_data)` (`profiles/history_taking/`)
- [ ] Case migration：加 `training_type`/`difficulty`/`time_limit_minutes` 列
- [ ] `case_data` 从 `PydanticJSONB(CaseDataSchema)` 改为 `JSONB`
- [ ] `CaseService.create/update` 验证从列级下放到 `_VALIDATORS[type]`
- [ ] 删除 `current_phase` / `messages.role` CHECK 约束
- [ ] `_create_record()` 从 profile 读 `initial_phase`
- [ ] `builder.py` 从 profile 读 `note_sources`
- [ ] `side_effects.py` emotion/initiative 按 `profile.has_emotion` 等包裹
- [ ] `prompt_builder.py` 模板来源从 `pm.get()` 改为 `profile.prompts`
- [ ] `prompt.py` `max_rounds` 从硬编码 8 改为 `profile.max_rounds`
- [ ] `phase.py` 移除 `_default_phase`，由 profile 提供 phases
- [ ] 适配层：各处嵌入 bridge 代码，profile 是新增不覆盖
- [ ] `TrainingRecord` 加 `training_type` 列
- [ ] 全量测试：`pnpm run check:full`

## 批次 B — 删除死基础设施 + 评分快照（~2 天）

前提：批次 A 已合入，profile 已接管 prompt/rubric 来源。

- [ ] 删除 `infrastructure/prompt/registry.py`（320 行）
- [ ] 删除 `infrastructure/prompt/manager.py` DB 部分（~200 行），保留 `render_template()`（~10 行）移入 `profiles/`
- [ ] 删除 `services/prompt.py`
- [ ] 删除 `services/rubric.py`
- [ ] 删除 `routers/admin/prompts.py`
- [ ] 删除 `routers/admin/rubrics.py`
- [ ] 删除 `models/llm.py` 中 `PromptTemplate` ORM 类
- [ ] 删除 `models/case_practice.py` 中 `Rubric` ORM 类
- [ ] 删除两个 DB 表 migration
- [ ] `TrainingRecord` 加 `prompt_snapshot` / `rubric_snapshot` JSONB 列
- [ ] `score_engine.py` 评分前快照 `profile.prompts` + `profile.rubric` 写入
- [ ] 删除 `rubric_frozen` 字段
- [ ] 删除 `detect_operation()` + `_DEFAULT_ALIASES`（`exam.py`）
- [ ] 删除 `EmotionState.decay()`（`emotion.py`）
- [ ] 删除 `initiative.py` 规则路径 `generate_initiative()`
- [ ] 合并 `effective_features()` / `resolve_features()`（`capabilities.py`）
- [ ] 全量测试：`pnpm run check:full`

## 批次 C — 前端 Scene 架构（~3 天）

前提：批次 A 已合入，API 返回 `training_type`。

- [ ] 提取共享服务 Hook：`useSSE` / `useScoring` / `useTTS` / `useMessageBus`
- [ ] 新增 `TrainingEntry`：路由分发 + 共享覆盖层（~30 行）
- [ ] 新增 `HistoryTakingScene`：从 `TrainingEngine` 迁移场景逻辑（~280 行）
- [ ] `panels/` 移入 `HistoryTakingScene`，删除全局 `PANELS` 数组 + `FloatingPanelHost`
- [ ] `CaseForm.tsx` 按 `training_type` 渲染不同表单 section
- [ ] `CaseBrief` / `CaseManageItem` 响应加 `training_type`
- [ ] `POST /api/cases/generate` 接收 `training_type` 参数
- [ ] `CaseSelect.tsx` 显示类型徽标
- [ ] `TrainingEngine.tsx` 标记废弃（保留兼容入口）
- [ ] 前端测试 + 类型检查：`npx tsc --noEmit; npx biome check`

## 批次 D — Triage 场景实现（独立评估）

前提：批次 C 已合入，前端有 Scene 框架。

- [ ] `profiles/triage/profile.py` + `TriageCaseSchema`
- [ ] 分诊专用 NoteSources
- [ ] 分诊评分标准 + 评分 prompt
- [ ] 分诊 AI 生成 prompt
- [ ] 分诊专用 operations 定义
- [ ] `TriageScene` 前端组件
- [ ] 管理表单 triage section（`CaseForm.tsx` 扩展）
- [ ] 全量测试：`pnpm run check:full`

---

## 依赖关系

```
批次 A ──→ 批次 B (A 提供 profile → B 删除旧路)
   │
   └──→ 批次 C (A 提供 API training_type → C 前端路由)
            │
            └──→ 批次 D (C 提供 Scene 框架 → D 渲染)
```

批次间可独立部署。A 完成后，B 和 C 可并行由不同子代理执行。
