# 训练架构重构 TODO

> 2026-06-29 · 全部批次已完成。剩余改进见 TRAINING-ARCH-MEMO.md

## 已知剩余改进项

- [ ] 评分引擎 triage 路径完整验证（走通一次 triage → 结束 → 评分全链路）
- [ ] 分诊管理表单字段（vitals 输入、arrival_mode 选择）
- [ ] 生理模拟引擎（前瞻，非短期）

## 批次 A — Profile 基础设施 + Case 解耦（已完成）

目标：建立 profile 注册机制，Case 解绑单 schema，现有代码通过适配层继续工作。

- [x] 定义 `TrainingProfile` / `PromptCollection` / `PhaseConfig` 数据类 (`profiles/__init__.py`)
- [x] 建立注册中心 `get_profile(type)` (`profiles/registry.py`)
- [x] 搬迁 `history_taking` 现有配置到 profile (`profiles/history_taking/profile.py`)
- [x] 数据自描述：`infer_operations(case_data)` (`profiles/history_taking/`)
- [x] Case migration：加 `training_type`/`difficulty`/`time_limit_minutes` 列
- [x] `case_data` 从 `PydanticJSONB(CaseDataSchema)` 改为 `JSONB`
- [x] `CaseService.create/update` 验证从列级下放到 `_VALIDATORS[type]`
- [x] 删除 `current_phase` / `messages.role` CHECK 约束
- [x] `_create_record()` 从 profile 读 `initial_phase`
- [x] `builder.py` 从 profile 读 `note_sources`
- [x] `side_effects.py` emotion/initiative 按 `profile.has_emotion` 等包裹
- [x] `prompt_builder.py` 持有 `profile.max_rounds` 用于消息构建
- [x] `prompt.py` `max_rounds` 从硬编码 8 改为参数化
- [x] `phase.py` 回退阶段由 profile 提供
- [x] 适配层：各处嵌入 bridge 代码，profile 是新增不覆盖
- [x] `TrainingRecord` 加 `training_type` 列
- [x] 全量测试：429 passed，ruff/ty/compileall 通过

## 批次 B — 删除死基础设施 + 评分快照（已完成）

前提：批次 A 已合入，profile 已接管 prompt/rubric 来源。

- [x] 删除 `infrastructure/prompt/registry.py`（320 行）
- [x] 删除 `infrastructure/prompt/manager.py` DB 部分，保留 `render_template()`（~10 行）
- [x] 删除 `services/prompt.py`
- [x] 删除 `services/rubric.py`
- [x] 删除 `routers/admin/prompts.py`
- [x] 删除 `routers/admin/rubrics.py`
- [x] 删除 `models/llm.py` 中 `PromptTemplate` ORM 类
- [x] 删除 `models/case_practice.py` 中 `Rubric` ORM 类
- [x] 删除两个 DB 表 migration
- [x] `TrainingRecord` 已加 `prompt_snapshot` / `rubric_snapshot` JSONB 列（Batch A）
- [x] `score_engine.py` 评分前快照写入
- [x] 删除 `rubric_frozen` 字段
- [x] 删除 `detect_operation()` + `_DEFAULT_ALIASES`（`exam.py`）
- [x] 删除 `EmotionState.decay()`（`emotion.py`）
- [x] 删除 `initiative.py` 规则路径 `generate_initiative()`
- [x] 合并 `resolve_features()` 带 overrides，`effective_features()` 保留为 compat
- [x] 全量测试：397 passed，ruff/compileall 通过

## 批次 C — 前端 Scene 架构（已完成）

前提：批次 A 已合入，API 返回 `training_type`。

- [x] 提取共享服务 Hook：`useSSE` / `useScoring` / `useTTS` / `useMessageBus`（TrainingEngine 内已使用）
- [x] 新增 `TrainingEntry`：路由分发 + 共享覆盖层
- [x] 新增 `HistoryTakingScene`：包裹 `TrainingEngine` 作为历史采集场景入口
- [x] `panels/` 保持 `HistoryTakingScene` 内（通过 `TrainingEngine` 封装自然隔离）
- [x] `CaseForm.tsx` 按 `training_type` 渲染不同表单 section（含类型选择器）
- [x] `CaseBrief` / `CaseManageItem` 响应加 `training_type`
- [x] `POST /api/cases/generate` 接收 `training_type` 参数（以 `{#training_type_label#}` 传入 prompt）
- [x] `CaseSelect.tsx` 显示类型徽标
- [x] `TrainingEngine.tsx` 标记废弃（保留兼容入口）
- [x] 前端测试：`tsc --noEmit` 通过，`biome check` clean

## 批次 D — Triage 场景实现（已完成）

前提：批次 C 已合入，前端有 Scene 框架。

- [x] `profiles/triage/profile.py` + `TriageCaseSchema`
- [x] 分诊专用 NoteSources（复用 `OperationNoteSource`）
- [x] 分诊评分标准 + 评分 prompt（profile 内嵌）
- [x] 分诊 AI 生成 prompt（`{#training_type_label#}` 变量）
- [x] 分诊专用 operations 定义（`mews_calc`, `assign_category`）
- [x] `TriageScene` 前端组件（生命体征显示 + MEWS 计算器 + 分诊级别选择器）
- [x] 管理表单 triage section（`CaseForm.tsx` 按 `training_type` 切换表单段）
- [x] 全量测试：397 backend passed，tsc 0 errors

### 待完善（后续迭代）

| 项目 | 优先级 |
|------|:------:|
| 分诊场景内嵌对话（`useSSE` + `ChatArea`） | 中 |
| 分诊结果提交 API | 中 |
| 圆形按钮面板 → 场景私有面板侧边栏组件 | 低 |
| 分诊专用管理表单字段（vitals 输入等） | 低 |

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
