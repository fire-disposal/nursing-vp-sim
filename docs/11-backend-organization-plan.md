# 11 — 后端组织结构收敛计划

> 决策日期：2026-07-29 | 最后更新：2026-08-01
> 状态：全部完成（含 Phase 5 repository 消除）
> 适用范围：`backend/` 目录组织、训练域边界、基础设施与业务模块划分
> 背景：项目由少量人维护，AI agent 改动频率高于人工审阅频率；目标不是企业级分层，而是可导航、可诊断、低跳转的单体架构。

## 一、最终定案

采用 **可导航单体（bounded modular monolith）**：

```text
普通业务：简单 router/service/model
训练业务：唯一复杂领域岛 modules/training
外部依赖：infra
核心内核：core
数据契约：models + schemas 顶层保留
```

禁止把后端改成微服务、企业 DDD、小文件森林或胖路由泥团。

## 二、目标目录（演进后）

```text
backend/
  main.py

  core/                       # 横跨全项目的稳定基础规则
    config.py
    database.py
    deps.py
    security.py
    permissions.py
    exceptions.py
    unit_of_work.py
    rate_limits.py
    datetime_utils.py
    roles.py                  # 角色常量
    template.py               # Jinja 模板管理器
    template_variables.py     # 模板变量注册
    gender.py                 # 性别常量
    jsonb.py                  # JSONB 工具
    login_strategies.py       # 登录策略
    pagination.py             # 分页工具

  models/                     # ORM — 顶层全局可见
    __init__.py
    _base.py
    auth.py
    school.py
    case.py
    assignment.py
    training.py
    qa.py
    llm.py
    voice.py
    feedback.py
    feedback_image.py
    notification.py
    questionnaire.py
    rate_limit.py

  schemas/                    # API contract — 顶层全局可见
    __init__.py
    auth.py
    user.py
    case.py
    case_schema.py
    assignment.py
    scoring.py
    qa.py
    llm.py
    ops.py
    common.py
    feedback.py
    notification.py
    questionnaire.py
    admin/                    # admin 子域共享 schema
      __init__.py
      classes.py
      grades.py
      llm.py
      roles.py
      stats.py
    training/                 # training 子域专用 schema
      __init__.py
      session.py
      scoring.py
      nursing.py
      exam.py
      emotion.py
      notification.py
      records.py
    voice/                    # voice 子域专用 schema
      __init__.py
      config.py
      cost.py

  modules/
    auth/                     # router/service 模式
      router.py
      service.py
    cases/
      router.py
      service.py
      generation.py           # 病例生成
      prompts.py              # 病例相关 prompt
    assignments/
      router.py
      service.py
    training/                 # 唯一复杂领域岛，按职责拆子目录
      __init__.py
      capabilities.py
      profile.py
      router/
        __init__.py
        session.py
        session_views.py
        chat.py
        scoring.py
        score_review.py
        progress.py
        ws.py
      pipeline/
        __init__.py
        builder.py
        context.py
        prompt_context.py
        prompt_context_builder.py
        runner.py
        stages.py
        middleware/
          __init__.py
          prompt_builder.py
          llm_caller.py
          persister.py
          side_effects.py
      scoring/
        __init__.py
        engine.py
        lifecycle.py
        mapping.py
        rubric.py
        rubric_data.py
        rubric_loader.py
        prompt_builder.py
        validation.py
      session/
        __init__.py
        state.py
        cache.py
        settlement.py
      tools/
        __init__.py
        base.py
        registry.py
        service.py
        nursing_diagnosis.py
        nursing_record.py
        physical_exam.py
        physical_exam_rules.py
        quiz.py
      patient_ai/
        chat_messages.py
        emotion.py
        emotion_profile.py
        guards.py
        initiative.py
        notes.py
        note_collector.py
        note_source.py
      prompts/
        __init__.py
        patient.py
        emotion.py
        initiative.py
        scoring.py
    qa/                       # router 拆子目录
      __init__.py
      logic.py
      citations.py
      prompts.py
      router/
        __init__.py
        endpoints.py
        sessions.py
        tools.py
      knowledge_base/
        chapter_index.py
        indexer.py
    voice/
      router.py
      service.py
    admin/                    # 每文件 = router + service 合并
      __init__.py
      users.py
      roles.py
      classes.py
      grades.py
      costs.py
      secrets.py
      ops.py
      stats.py
      rubrics.py
      profiles.py
      exports.py
      voice.py
      llm_monitor.py
      system_notifications.py
    feedback/
      router.py
      service.py
    questionnaires/
      router.py
      service.py
      response_service.py

  infra/
    __init__.py
    bootstrap.py
    diagnose.py
    diagnostics.py
    metrics.py
    telemetry.py
    queue.py
    realtime.py
    exporter.py
    logging_setup.py
    ops_queries.py
    scoring_progress.py
    training_queries.py      # Settlement 异步 DB 查询（替代 TrainingRepository）
    llm/
      __init__.py
      client.py
      router.py
      logging.py
      parsing.py
      token_counter.py
      call_recorder.py
      circuit.py
      data.py
      profile.py
    tts/
      __init__.py
      client.py
      pool.py
      circuit.py
      mapper.py
    volc/
      __init__.py
      auth.py

  migrations/
  scripts/
  tests/
```

**不复存在**：`repositories/`、`routers/`、`services/`、`contexts/`、顶层 `prompts/`。

## 三、目录职责

### `core/`

项目内核。只放横跨全项目且稳定的基础规则：配置、数据库、认证、权限、异常、事务、时间工具、分页、模板、角色/性别常量。

不得放业务逻辑、LLM prompt、训练状态机。

### `modules/`

业务入口。每个模块对应一个人能理解的产品领域。

普通模块使用：

```text
router.py
service.py
```

复杂模块允许按业务阶段拆文件/子目录，但不能按抽象层级造目录。

### `modules/training/`

唯一复杂领域岛。子目录划分：

- `router/` — HTTP/WS 入口：session lifecycle、chat SSE、scoring、progress
- `pipeline/` — prompt → LLM → persist → side effects 主链路
- `scoring/` — 评分生命周期、量表加载、映射
- `session/` — 运行态 state、cache、结算循环
- `tools/` — 工具注册、授权、幂等、物理检查规则
- `patient_ai/` — emotion 引擎、initiative 引擎、note 收集
- `prompts/` — 训练域专属 prompt 模板

训练主链路必须从这些文件进入，不新增第二套 pipeline、event bus 或 plugin lifecycle。

### `infra/`

外部系统与运行设施：LLM、TTS、队列、诊断、指标、实时连接、导出、日志配置、异步训练查询。

infra 不得决定学生是否能看病例、训练是否完成、工具是否允许执行。

### `models/` 与 `schemas/`

顶层保留。ORM 和 API contract 全局可见，便于 agent 查找字段来源。

不把模型藏进各 module 子目录。

## 四、文件粒度规则

| 文件大小 | 处理 |
|---|---|
| 0–1KB | 可能太碎；除纯 schema、`__init__` 外应考虑合并 |
| 1–5KB | 理想 |
| 5–15KB | 正常 |
| 15–25KB | 可接受，但必须有清晰段落 |
| >25KB | 按业务阶段拆分 |
| >35KB | 必须拆分 |

拆分按业务阶段，不按企业抽象：

```text
好：session.py / session_views.py / session_lifecycle.py
坏：use_case.py / manager.py / processor.py / helper.py
```

## 五、禁止新增的形态

- 没有第二真实消费者的 registry。
- `manager.py`、`processor.py`、`helper.py`、`common.py`、`utils.py` 等模糊文件。
- 单纯 CRUD repository（所有数据访问走 service 的 `db: Session` 直调）。
- 运行时自动发现插件。
- 新训练类型用来证明抽象。
- 在 router 中写多表 mutation。
- side effects 阻塞 chat、TTS、工具提交或评分正式产物。
- StreamingResponse 持有无关 DB transaction。
- Redis 承载 Message、Action、Assessment、Score 等正式产物。

## 六、状态分层

| 层级 | 例子 | 存储 | 失败语义 |
|---|---|---|---|
| 正式产物 | Message, NursingAssessment, Score | PostgreSQL | 失败即业务失败 |
| 工具审计 | TrainingToolRequest, TrainingAction | PostgreSQL | 失败即工具失败 |
| 运行态 | emotion, initiative, presence | PostgreSQL 短期；未来 Redis | 可降级 |
| 指标日志 | metrics, LLM/TTS logs | memory / PostgreSQL / file | best-effort |

任何新增字段、表或缓存必须先归类。

## 七、迁移路线

### Phase 0 — 冻结新增横向目录 ✅

不再新增顶层业务目录。`routers/`、`services/`、`contexts/`、`prompts/` 顶层目录已全部消除。

### Phase 1 — 导读与边界注释 ✅

- `modules/training/__init__.py`：训练域地图。
- `modules/training/pipeline/__init__.py`：pipeline 顺序与写入规则。
- `modules/training/tools/__init__.py`：工具授权、幂等、事务入口。
- `core/database.py`：pool、timeout、streaming transaction 规则。
- `infrastructure/` → `infra/` 重命名，`diagnostics` 迁入 `infra/`。

### Phase 2 — 删除伪扩展点 ✅

- `TrainingProfileRegistry` → 删除，合并为 `modules/training/profile.py`。
- `PipelineRegistry` → 删除。
- `ScoringProgress` ORM 表 → 删除。
- MEWS/triage 工具 → 删除。
- `training_type` 分支逻辑 → 删除。
- `Grade`/`UserClass` → 保留（为学校管理功能服务）。
- runtime Exam LLM 痕迹 → 删除。

### Phase 3 — 建立 `modules/` 过渡层 ✅

一次性完成全量迁移（非原计划的逐步 3 模块）：

| 迁移 | 结果 |
|---|---|
| `routers/auth.py` + `services/auth.py` | `modules/auth/` |
| `routers/cases.py` + `services/case.py` | `modules/cases/` |
| `routers/assignments.py` + `services/assignments.py` | `modules/assignments/` |
| `contexts/training/` 全量 | `modules/training/` |
| `routers/qa.py` + `contexts/qa/` | `modules/qa/` |
| `routers/tts.py` + `services/tts.py` | `modules/voice/` |
| `routers/admin*.py` + `services/admin*.py` | `modules/admin/` |
| `routers/feedback.py` + `services/feedback.py` | `modules/feedback/` |
| `routers/questionnaire*.py` + `services/questionnaire*.py` | `modules/questionnaires/` |
| `prompts/` 目录 | 按领域分散到 `modules/*/prompts/` |
| `services/` 空壳 | 删除 |

顶层 `routers/`、`services/`、`contexts/`、`prompts/` 全部消除。

### Phase 4 — 训练域轻拆 ✅

- `router/session.py` → `modules/training/router/session.py` + `session_views.py`
- `router/scoring.py` → `modules/training/router/scoring.py`
- `scoring/engine.py` → `modules/training/scoring/engine.py` + 配套文件
- Pipeline builder → `modules/training/pipeline/builder.py`

无 `usecase` 小文件森林产生。

### 演进偏离（合理的，已纳入目标目录）

以下与原始计划不同，但属于正向设计演进而非偏离：

| 项目 | 原计划 | 实际 | 理由 |
|---|---|---|---|
| `modules/training/` | 扁平 9 文件 | 7 子目录 | >15 个文件时扁平不可导航，子目录按职责分区 |
| `modules/qa/` | 扁平 `router.py` | `router/endpoints+sessions+tools` | 3 个路由文件需组织，子目录优于前缀命名 |
| `modules/admin/` | `router.py` + 子文件 | 15 扁平文件（router+service 合并） | 每个 admin 功能足够小，合并优于拆分 |
| 无 `modules/users/` | 计划有 | 不存在 | 用户管理在 `admin/users.py`，无需独立模块 |
| `core/` 多出文件 | 9 文件 | 16 文件 | `gender.py`/`jsonb.py`/`template*.py`/`pagination.py`/`login_strategies.py` 均为跨域工具 |
| `schemas/` 子目录 | 扁平 | `admin/`、`voice/`、`training/` | 复杂域 schema 集中管理 |
| `infra/` 多出文件 | 少 | `ops_queries.py`、`logging_setup.py`、`diagnose.py`、`scoring_progress.py`、`volc/`、`llm/data.py`、`llm/profile.py` | 外部依赖与运行设施 |

### Phase 5 — 消除 `repositories/` 层 ✅

**目标**：消除 `repositories/` 目录，所有数据访问走 `service.py` 的 `db: Session` 直调。

**结果（2026-08-01 核实）**：`repositories/` 目录与顶层 `routers/`、`services/`、`contexts/` 均不复存在；`Repository` 基类已移除，数据访问全部内联为 `self.db` 直调（`modules/training/patient_ai/emotion/repository.py` 保留为训练域内实现细节，不属于旧分层）。

**策略**：内联 + 优化（非机械搬运）。

#### 5.1 内联模式

```
Before:
  self.repo = CaseRepository(db)
  case = self.repo.get_or_404(case_id, "病例不存在")

After:
  case = self.db.get(Case, case_id)
  if case is None:
      raise NotFoundError("病例不存在")
```

`Repository` 基类方法等价替换：

| 原 repo 方法 | 内联后 |
|---|---|
| `self.repo.get(id)` | `self.db.get(Model, id)` |
| `self.repo.get_or_404(id, msg)` | `obj = self.db.get(Model, id); if obj is None: raise NotFoundError(msg)` |
| `self.repo.add(obj)` | `self.db.add(obj); self.db.flush()` |
| `self.repo.delete(obj)` | `self.db.delete(obj); self.db.flush()` |
| `self.repo.query()` | `self.db.query(Model)` |
| `self.repo.list_all(*criteria)` | `self.db.query(Model).filter(*criteria).all()` |
| `self.repo.exists(*criteria)` | `self.db.query(self.db.query(Model).filter(*criteria).exists()).scalar()` |

自定义查询方法直接移入 service 类，保持方法签名不变。

#### 5.2 优化机会（同步执行）

1. **`LLMCallLogRepository` + `VoiceCallLogRepository`**：不继承 `Repository` 基类，本身就是 `self.db` 上的查询方法集。直接移入 `CostService` 和 `LLMMonitorService`，消除 2 个独立类。

2. **`shared.nullify_user_class_associations`**：3 行 `db.execute(sa_update(...))`，被 `classes.py` 和 `grades.py` 各调一次。内联到两处调用点，删除 `shared.py`。

3. **`SyncRepository` + `TrainingRepository`**：`TrainingRepository` 是唯一 `SyncRepository` 子类。异步方法（`find_timeout_records`、`mark_completed` 等）移入 `infra/training_queries.py`；同步方法（`find_timeout_records_sync`、`mark_completed_sync`）已在 settlement 调用的签名中接受 `db: Session`，可直接内联。删除 `SyncRepository` 和 `Repository` 两个基类。

4. **Session 管理**：`AssignmentService._notify_students` 和 `_push_notifications` 自行创建 `SessionLocal()`——这是遗留模式。暂保持不变（fire-and-forget 通知语义独立于请求事务），标注为后续改进项。

#### 5.3 执行批次

| 批次 | 模块 | Repository 文件 | 复杂度 |
|---|---|---|---|
| A | `modules/feedback/` | `feedback.py` | 低 — 5 个查询方法 |
| A | `modules/admin/system_notifications.py` | `notification.py` | 低 — 1 个方法 |
| A | `modules/questionnaires/` (2 文件) | `questionnaire_question.py`、`questionnaire_template.py`、`questionnaire_response.py` | 中 — 多个查询方法 |
| B | `modules/assignments/` | `assignment.py` | 中 — 5 个自定义方法 |
| B | `modules/cases/` | `case.py` | 中 — 4 个自定义方法 |
| B | `modules/admin/classes.py` | `class_.py` + `shared.py` | 中 — 5 个自定义方法 |
| B | `modules/admin/grades.py` | `grade.py` + `shared.py` | 中 — 6 个自定义方法 |
| B | `modules/admin/roles.py` | `role.py` | 中 — 7 个自定义方法 |
| C | `modules/admin/users.py` | `user.py` | 高 — 13 个方法 |
| C | `modules/admin/costs.py` | `llm_log.py` + `voice_log.py` | 高 — 20 个查询方法 |
| C | `modules/admin/llm_monitor.py` | `llm_log.py` | 高 — 共享 costs 的 repo |
| C | `infra/bootstrap.py` | `training.py` | 中 — `SyncRepository` 异步模式 |

#### 5.4 测试适配

| 测试文件 | 处理 |
|---|---|
| `tests/core/test_repository_base.py` | 删除 — 基类不复存在 |
| `tests/admin/test_grade_repository.py` | 重写为 `test_grade_service.py`，测试 service 层 |
| `tests/cases/test_case_list_brief.py` | 将 `CaseRepository` 引用改为直接使用 `CaseService` |

#### 5.5 完成标准

- [ ] `repositories/` 目录完全删除
- [ ] `Repository`、`SyncRepository` 基类删除
- [ ] 所有模块数据访问走 `self.db` 直调
- [ ] 全量测试通过
- [ ] `grep -r "from repositories\." backend/` 返回空

## 八、验收状态

| 标准 | 状态 |
|---|---|
| 核心请求最多跳 3 层即可理解 | ✅ 模块内 router→service→(db 直调) |
| 新 agent 能从 `modules/training/__init__.py` 理解训练主链路 | ✅ 有详细域地图 |
| 所有 StreamingResponse 都说明 DB transaction 生命周期 | ✅ 通过 pipeline middleware 约束 |
| 所有 side effects 明确 must-succeed / best-effort | ✅ pipeline side_effects 中间件 |
| `/api/diagnose` 能观察 DB pool、lock timeout、stream active、运行态写入失败 | ✅ `infra/diagnose.py` + `infra/diagnostics.py` |
| 不再保留没有第二消费者的 registry 或训练类型分支 | ✅ 已删除 |
| 不再存在 CRUD repository 层 | ✅ 已完成（2026-08-01 核实） |
| 移动后目标模块测试通过 | ✅ 所有测试通过 |

## 九、最终原则

> 后端是给少数维护者和高频 agent 使用的可导航单体。优先减少伪抽象、减少跳转、明确事务边界和状态归属；不为了企业级观感牺牲阅读体验。
