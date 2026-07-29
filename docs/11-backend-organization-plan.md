# 11 — 后端组织结构收敛计划

> 决策日期：2026-07-29
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

## 二、目标目录

```text
backend/
  main.py

  core/
    config.py
    database.py
    deps.py
    security.py
    permissions.py
    exceptions.py
    unit_of_work.py
    rate_limits.py
    datetime_utils.py

  models/
    auth.py
    school.py
    case.py
    assignment.py
    training.py
    qa.py
    llm.py
    voice.py
    feedback.py
    notification.py
    questionnaire.py

  schemas/
    auth.py
    user.py
    case.py
    assignment.py
    training.py
    scoring.py
    qa.py
    voice.py
    admin.py
    ops.py
    questionnaire.py

  modules/
    auth/
      router.py
      service.py
    users/
      router.py
      service.py
    cases/
      router.py
      service.py
      generation.py
    assignments/
      router.py
      service.py
    training/
      __init__.py
      router.py
      session.py
      chat.py
      pipeline.py
      tools.py
      scoring.py
      assessment.py
      state.py
      views.py
      capabilities.py
    qa/
      router.py
      service.py
      knowledge_base.py
      citations.py
    voice/
      router.py
      service.py
    admin/
      router.py
      users.py
      roles.py
      cases.py
      costs.py
      secrets.py
      ops.py
    feedback/
      router.py
      service.py
    questionnaires/
      router.py
      service.py

  infra/
    bootstrap.py
    diagnostics.py
    metrics.py
    telemetry.py
    queue.py
    realtime.py
    exporter.py
    llm/
      client.py
      router.py
      logging.py
      parsing.py
      token_counter.py
    tts/
      client.py
      pool.py
      circuit.py
      mapper.py
    prompt/
      engine.py
      templates.py

  prompts/
  migrations/
  scripts/
  tests/
```

## 三、目录职责

### `core/`

项目内核。只放横跨全项目且稳定的基础规则：配置、数据库、认证、权限、异常、事务、时间工具。

不得放业务逻辑、LLM prompt、训练状态机。

### `modules/`

业务入口。每个模块对应一个人能理解的产品领域。

普通模块使用：

```text
router.py
service.py
```

复杂模块允许按业务阶段拆文件，但不能按抽象层级造目录。

### `modules/training/`

唯一复杂领域岛。允许包含：

```text
chat.py        对话与 SSE
session.py     训练生命周期
pipeline.py    prompt → LLM → persist → side effects
tools.py       工具授权、幂等、事务
scoring.py     评分生命周期
assessment.py  护理评估单
state.py       emotion / initiative 运行态
views.py       StudentCaseView / TeacherCaseView
```

训练主链路必须从这些文件进入，不新增第二套 pipeline、event bus 或 plugin lifecycle。

### `infra/`

外部系统与运行设施：LLM、TTS、队列、诊断、指标、实时连接、导出。

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
- 单纯 CRUD repository。
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

### Phase 0 — 冻结新增横向目录

不再新增顶层业务目录。新业务优先进入现有 `routers/services/contexts`，迁移窗口后进入 `modules/`。

### Phase 1 — 导读与边界注释

先不移动大量代码。补充：

- `contexts/training/__init__.py`：训练域地图。
- `contexts/training/pipeline/__init__.py`：pipeline 顺序与写入规则。
- `contexts/training/tools/__init__.py`：工具授权、幂等、事务入口。
- `core/database.py`：pool、timeout、streaming transaction 规则。

### Phase 2 — 删除伪扩展点

优先减少误导：

- `training_type` 分支。
- `ProfileRegistry`。
- triage / MEWS 残留。
- Grade / UserClass。
- ORM `ScoringProgress`。
- runtime Exam LLM 痕迹。

### Phase 3 — 建立 `modules/` 过渡层

先迁移最稳定、收益最高的模块：

1. `routers/tts.py + services/tts.py` → `modules/voice/router.py + service.py`
2. `routers/cases.py + services/case.py` → `modules/cases/router.py + service.py`
3. `contexts/training` → `modules/training`（最后做，单独验证）

每次迁移只移动一个模块，并运行该模块对应测试。

### Phase 4 — 训练域轻拆

只处理超过 25KB 或职责混杂文件：

- `router/session.py`
- `router/scoring.py`
- `scoring/engine.py`

拆成业务阶段文件，不引入 usecase 小文件森林。

## 八、验收标准

- 核心请求最多跳 3 层即可理解。
- 新 agent 能从 `modules/training/__init__.py` 理解训练主链路。
- 所有 StreamingResponse 都说明 DB transaction 生命周期。
- 所有 side effects 明确 must-succeed / best-effort。
- `/api/diagnose` 能观察 DB pool、lock timeout、stream active、运行态写入失败。
- 不再保留没有第二消费者的 registry 或训练类型分支。
- 普通 CRUD 不新增 repository。
- 移动后目标模块测试通过。

## 九、最终原则

> 后端是给少数维护者和高频 agent 使用的可导航单体。优先减少伪抽象、减少跳转、明确事务边界和状态归属；不为了企业级观感牺牲阅读体验。
