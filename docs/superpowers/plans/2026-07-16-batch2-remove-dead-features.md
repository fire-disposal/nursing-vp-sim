# 批次二：移除死代码（阶段系统/微信/学习笔记） 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 移除三块"半接线"原型阶段遗留代码：阶段系统（D9）、微信后端登录（D10）、学习笔记（D12）。每块独立可提交，最终 `pnpm run check:full` 全绿 + alembic roundtrip 通过。
**Architecture:** 渐进式删除：先砍前端与业务代码（每个 commit 站得住、`import` 不报错），再跑迁移删列/删表，最后收尾清理残留与再生 `.gen.ts`。
**Tech Stack:** FastAPI + SQLAlchemy + Alembic + React/TypeScript
**Spec:** docs/superpowers/specs/2026-07-16-prototype-consolidation-design.md（批次二：2.1~2.3）

---

## 待决问题调查结论

### 问题 1：progress.py 中 initiative/emotion history 端点是否被前端使用？

**结论：三端点中仅 `initiative/trigger` 被使用，其余两个 getter 未被调用。**

- `POST /api/training/{record_id}/initiative/trigger` — **保留**。前端 `EmotionIndicator.tsx:71` 通过 `triggerInitiative()`（`frontend/src/api/training.ts:60`）调用。
- `GET /api/training/{record_id}/emotion/history` — **删除**。`.gen.ts` 有自动生成的类型定义，但无任何 `.tsx` 组件或 hook 实际调用。
- `GET /api/training/{record_id}/initiative/history` — **删除**。同样仅 `.gen.ts` 有类型，无实际调用。

**处置**：`progress.py` 不整文件删除，改为**部分删减**——删除 `advance-phase`、`emotion/history`、`initiative/history` 三个端点（及其相关 import 和 schema 引用），保留 `initiative/trigger` 端点。文件重命名为 `initiative.py` 或保留原名只删代码——计划中采用**保留文件名、删代码段**的方式，减少 diff 噪音。

### 问题 2：`profiles/history_taking/notes.py` 是 prompt 数据源还是学习笔记功能？

**结论：是 prompt 管道 `NoteSource`（上下文注入），保留不删。**

- `EmotionNoteSource` 和 `IdentityGuardSource` 继承自 `contexts.patient.note_source.NoteSource`，是**每轮 LLM 调用前向系统提示注入上下文**的数据源。
- 注册于 `profiles/history_taking/profile.py:78` 的 `note_sources` 列表，被 `pipeline/builder.py:47-48` 组装到 `NoteCollector`，在 `prompt_builder` 中间件中注入 system prompt。
- 与"学习笔记"（`models.Note` / `routers.notes.py` / `NoteCard.tsx`）**命名巧合，功能完全不同**。

---

## 迁移基础

执行前确认迁移链 head（当前应输出 `mrlze6snkjy4 (head)`）：

```bash
cd backend && uv run alembic heads
```

## 任务 1：砍微信后端（最小独立块）

**Files — Delete:**
- `backend/infrastructure/wechat.py`（29 行）
- `backend/core/login_strategies/wechat.py`（23 行）

**Files — Modify:**
- `backend/routers/auth.py:19-22,54-79` — 删 WechatLoginRequest/WechatBindRequest/WechatLoginResponse/WechatRegisterRequest 导入；删 3 个微信端点
- `backend/services/auth.py:12,133-225` — 删 `from infrastructure.wechat import code2session`；删 `wechat_login()`、`wechat_bind()`、`wechat_register()` 三个方法
- `backend/schemas/auth.py:41-65` — 删 WechatLoginRequest、WechatBindRequest、WechatRegisterRequest、WechatLoginResponse
- `backend/core/login_strategies/__init__.py:39,43` — 删 `from .wechat import WeChatLoginStrategy` 和 dict 条目 `"wechat": WeChatLoginStrategy`
- `backend/core/config.py:88-89` — 删 `WECHAT_APPID` 和 `WECHAT_SECRET`
- `.env.example:93-99` — 删"可选: 微信小程序登录"区块

- [ ] 删 `backend/infrastructure/wechat.py`
- [ ] 删 `backend/core/login_strategies/wechat.py`
- [ ] `backend/routers/auth.py`：删 imports（L19-22）和 3 个微信端点（L54-79）
- [ ] `backend/services/auth.py`：删 L12 `from infrastructure.wechat import code2session` + 删 L133-225 三个方法
- [ ] `backend/schemas/auth.py`：删 L41-65 四个微信 schema
- [ ] `backend/core/login_strategies/__init__.py`：删 L39 import 和 L43 dict 条目
- [ ] `backend/core/config.py`：删 L88-89 WECHAT_APPID/WECHAT_SECRET
- [ ] `.env.example`：删 L93-99 微信小程序区块
- [ ] 确认无微信相关测试文件（grep 已确认 `backend/tests/` 零引用）
- [ ] `cd backend && uv run ruff check && uv run ty check`
- [ ] `cd backend && uv run python -m pytest tests/auth/ -x -q`
- [ ] Commit：`🔥 remove: 移除微信小程序后端登录代码`

> **注意**：`models/auth.py:49` 的 `wechat_openid` 列保留不做迁移（spec 决议）。`.env.example` 中 WECHAT_APPID/WECHAT_SECRET 区块删除。

---

## 任务 2：砍阶段系统代码（先代码后迁移）

### 2a：删除阶段系统后端代码

**Files — Delete:**
- `backend/contexts/training/pipeline/phase.py`（114 行）
- `backend/contexts/training/pipeline/middleware/phase_guard.py`（14 行）
- `backend/contexts/training/pipeline/middleware/phase_transition.py`（32 行）
- `backend/tests/training/test_pipeline_phase.py`（126 行）

**Files — Modify:**

1. `backend/contexts/training/pipeline/context.py`：
   - 删 L10 `from .phase import Phase, parse_phases`
   - 删 L28 `STATE_PHASE_OP_COUNT` 常量
   - 删 L43-47 五个字段：`phases`、`current_phase`、`phase_index`、`manual_advance_requested`、`phase_operation_count`
   - 删 L65-84 `setup_phases()` 和 `_count_phase_operations()` 方法

2. `backend/contexts/training/pipeline/__init__.py`：
   - 删 L9 `STATE_PHASE_OP_COUNT` 导入
   - 删 L17-23 phase 导入块（Phase, get_phase_by_order, parse_phase, parse_phases, try_advance_phase）
   - 删 L33 `"STATE_PHASE_OP_COUNT"` from `__all__`
   - 删 L39,44-47,51 phase 相关 `__all__` 条目

3. `backend/contexts/training/pipeline/middleware/__init__.py`：
   - 删 L3 `from .phase_guard import phase_guard`
   - 删 L4 `from .phase_transition import phase_transition`
   - 删 L11-12 `"phase_guard"`, `"phase_transition"` from `__all__`

4. `backend/contexts/training/pipeline/builder.py`：
   - 删 L20-21 `phase_guard, phase_transition` 导入
   - 删 L26 `_CORE_MIDDLEWARE[PipelineStage.GUARD] = [phase_guard]`
   - 删 L27 `_CORE_MIDDLEWARE[PipelineStage.TRANSITION] = [phase_transition]`

5. `backend/contexts/training/pipeline/middleware/persister.py`：
   - 删 L9 `STATE_PHASE_OP_COUNT` 导入
   - 删 L27 `_persist_phase_op_count(ctx)` (error 分支)
   - 删 L39 `_persist_phase_op_count(ctx)` (正常分支)
   - 删 L60-65 `_persist_phase_op_count()` 函数

6. `backend/contexts/training/router/chat.py:84`：
   - 删 `ctx.setup_phases()`

7. `backend/contexts/training/router/progress.py` — **部分删减（保留 initiative/trigger）**：
   - 删 L13 `from profiles.history_taking.emotion import get_emotion`（仅 advance-phase 和 emotion/history 使用）
   - 删 L21-25 `InitiativeTriggerResponse, PhaseAdvanceResponse, EmotionHistoryResponse, InitiativeHistoryResponse` 导入——改为只保留 `InitiativeTriggerResponse`（来自 schemas）
   - 删 L27 `from ..pipeline.phase import parse_phases, try_advance_phase`
   - 删 L34-78 `advance_phase` 端点
   - 删 L144-157 `get_emotion_history` 端点
   - 删 L160-181 `get_initiative_history` 端点
   - 删 `log` 导入（若不再使用则删；若 trigger_initiative 中有 log 则保留）
   - 保留 L81-141 `trigger_initiative` 端点 + 所需 imports（Request, CallContext, models, schemas.InitiativeTriggerResponse, is_enabled, initiative 模块等）

8. `backend/contexts/training/router/session.py`：
   - L174：删 `record.current_phase = profile.initial_phase`
   - L437：删 `current_phase=r.current_phase,`（TrainingRecordBrief 构造）
   - L524：删 `current_phase=record.current_phase,`（TrainingRecordDetail 构造）

9. `backend/schemas/training.py`：
   - L46：删 `current_phase: str | None = None`（TrainingRecordBrief）
   - L102：删 `current_phase: str | None = None`（TrainingRecordDetail）
   - L139-143：删 `PhaseAdvanceResponse` 类
   - L201-210：删 `EmotionHistoryEntry` + `EmotionHistoryResponse` 类
   - L213-220：删 `InitiativeMessageEntry` + `InitiativeHistoryResponse` 类

10. `backend/profiles/registry.py`：
    - 删 L10-23 `PhaseConfig` 类
    - 删 L38-39 `TrainingProfile` 的 `initial_phase` 和 `phases` 字段

11. `backend/profiles/history_taking/profile.py`：
    - 删 L5-9 `PhaseConfig` 导入块（保留 PromptCollection, TrainingProfile）
    - 删 L66 `initial_phase="history_taking",`
    - 删 L67-77 `phases=[...]` 参数

12. `backend/profiles/triage/profile.py`：
    - L4：删 `PhaseConfig` 导入（保留 PromptCollection, TrainingProfile）
    - L80：删 `initial_phase="triage_assessment",`
    - L81-91：删 `phases=[PhaseConfig(...)]` 参数

13. `backend/contexts/training/router/triage.py:69`：
    - 删 `rs["phase_op_count"] = rs.get("phase_op_count", 0) + 1`

14. `backend/services/physical_exam.py:91`：
    - 删 `rs["phase_op_count"] = rs.get("phase_op_count", 0) + 1`

15. `backend/tests/training/test_pipeline_integration.py`：
    - 删 L8 `from contexts.training.pipeline.phase import Phase`
    - 删 L18 `record.current_phase = None`
    - 删 L66 `ctx.setup_phases()`
    - 删 L67 `ctx.current_phase = Phase(id="history_taking")`

- [ ] 删 4 个整文件（phase.py, phase_guard.py, phase_transition.py, test_pipeline_phase.py）
- [ ] 修改 pipeline/context.py（5 处删除）
- [ ] 修改 pipeline/__init__.py（4 处删除）
- [ ] 修改 pipeline/middleware/__init__.py（4 处删除）
- [ ] 修改 pipeline/builder.py（4 处删除）
- [ ] 修改 pipeline/middleware/persister.py（4 处删除）
- [ ] 修改 pipeline/chat.py 删 `ctx.setup_phases()`
- [ ] 修改 progress.py 删 3 个端点保留 1 个（initiative/trigger）
- [ ] 修改 session.py（3 处 current_phase 删除）
- [ ] 修改 schemas/training.py（8 处删除）
- [ ] 修改 profiles/registry.py（PhaseConfig 类 + TrainingProfile 2 字段）
- [ ] 修改 profiles/history_taking/profile.py（initial_phase + phases）
- [ ] 修改 profiles/triage/profile.py（initial_phase + phases）
- [ ] 修改 triage.py 删 phase_op_count 写入
- [ ] 修改 physical_exam.py 删 phase_op_count 写入
- [ ] 修改 test_pipeline_integration.py（phase 引用清理）
- [ ] `cd backend && uv run ruff check && uv run ty check`
- [ ] `cd backend && uv run python -m pytest tests/training/ -x -q`
- [ ] Commit：`🔥 remove: 移除阶段系统代码（pipeline phase/middleware/router/schema/profile）`

### 2b：阶段系统迁移 — drop current_phase 列

```bash
cd backend && uv run alembic revision --autogenerate -m "drop_current_phase"
```

然后**不要用 autogenerate**，手工编写迁移文件。将生成的迁移文件移到 `ddl/`：

```bash
mkdir -p backend/migrations/versions/ddl
# 将自动生成的迁移移入 ddl/，覆盖其 upgrade/downgrade
```

**upgrade 代码：**

```python
def upgrade() -> None:
    op.drop_constraint("ck_training_records_current_phase", "training_records", type_="check")
    op.drop_column("training_records", "current_phase")
```

**downgrade 代码（完整恢复列 + check 约束）：**

```python
def downgrade() -> None:
    op.add_column(
        "training_records",
        sa.Column("current_phase", sa.String(50), nullable=True),
    )
    op.create_check_constraint(
        "ck_training_records_current_phase",
        "training_records",
        "current_phase IN ('history_taking', 'physical_exam', 'ending')",
    )
```

- [ ] 生成迁移：`cd backend && uv run alembic revision --autogenerate -m "drop_current_phase"`
- [ ] 将新迁移文件移入 `ddl/`，覆盖 upgrade/downgrade 为上述代码
- [ ] `cd backend && uv run alembic upgrade head`
- [ ] `cd backend && uv run alembic downgrade -1`
- [ ] `cd backend && uv run alembic upgrade head`（roundtrip 验证通过）
- [ ] `cd backend && uv run python -m pytest tests/training/ -x -q`
- [ ] Commit：`🗃️ db: drop current_phase 列及约束（阶段系统移除）`
- [ ] 同步删除 `models/training.py:59` `current_phase` Mapped 列定义
- [ ] Commit：`🔥 remove: 删除 TrainingRecord.current_phase 模型列`

---

## 任务 3：砍学习笔记代码

### 3a：删除前端 + 后端业务代码

**Files — Delete:**
- `backend/routers/notes.py`（154 行）
- `frontend/src/api/notes.ts`（20 行）
- `frontend/src/components/training/scene-cards/NotesCard.tsx`（65 行）
- `frontend/src/training/components/NoteEditor.tsx`（127 行）

**Files — Modify:**

1. `backend/routers/__init__.py`：
   - L18：`from routers import auth, cases, feedback, notes, questionnaires, records, stats` → 删 `notes`
   - L20：`for mod in (auth, cases, feedback, notes, questionnaires, records, stats):` → 删 `notes`

2. `backend/contexts/training/router/session.py`：
   - L25：删 `Note` 导入
   - L473：删 `note_records = db.query(Note)...`
   - L533：删 `notes=note_records,`（TrainingRecordDetail 构造）
   - L570：删 `db.query(Note).filter(Note.record_id == record_id).delete()`

3. `backend/models/training.py`：
   - L135-165：删 `Note` 和 `NoteComment` 模型类

4. `backend/models/__init__.py`：
   - L17-18：删 `Note, NoteComment` 导入
   - L41-42：删 `"Note", "NoteComment"` from `__all__`

5. `backend/schemas/training.py`：
   - L82-93：删 `NoteItem` 和 `NoteCreateRequest` 类
   - L111：删 `notes: list["NoteItem"] = []`（TrainingRecordDetail）

6. `frontend/src/api/query-keys.ts`：
   - L38-41：删 `notes.byRecord` 键定义

7. `frontend/src/components/training/scene-cards/registry.ts`：
   - L5：删 `import NotesCard from "./NotesCard";`
   - L26：删注释行 `// { id: "notes", ...}`（已注释的行清理）

- [ ] 删 4 个整文件（notes.py, notes.ts, NotesCard.tsx, NoteEditor.tsx）
- [ ] 修改 `routers/__init__.py`（2 处删除 notes 注册）
- [ ] 修改 `session.py`（4 处删除 notes 引用）
- [ ] 修改 `models/training.py`（删 Note + NoteComment 模型）
- [ ] 修改 `models/__init__.py`（2 处删除导出）
- [ ] 修改 `schemas/training.py`（3 处删除）
- [ ] 修改 `query-keys.ts`（删 notes.byRecord）
- [ ] 修改 `registry.ts`（删 NotesCard import + 注释行）
- [ ] `cd backend && uv run ruff check && uv run ty check`
- [ ] `cd frontend && npx tsc --noEmit && npx biome check`
- [ ] `cd backend && uv run python -m pytest tests/training/ -x -q`
- [ ] Commit：`🔥 remove: 移除学习笔记功能（路由/模型/前端组件）`

### 3b：学习笔记迁移 — drop notes / note_comments 表

```bash
cd backend && uv run alembic revision --autogenerate -m "drop_notes_tables"
```

手工覆盖 upgrade/downgrade，移入 `ddl/`：

**upgrade 代码：**

```python
def upgrade() -> None:
    op.drop_table("note_comments")
    op.drop_table("notes")
```

**downgrade 代码（完整重建两表到最终结构，汇总自 `0001_initial.py:438-449` + `449911a0d604_extend_notes_schema.py`）：**

```python
def downgrade() -> None:
    op.create_table(
        "notes",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("record_id", sa.Integer(), nullable=True),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.Column("type", sa.String(20), server_default="free", nullable=False),
        sa.Column("title", sa.String(200), server_default="", nullable=False),
        sa.Column("content_jsonb", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("tags", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("is_private", sa.Boolean(), server_default="true", nullable=False),
        sa.Column("training_type", sa.String(50), nullable=True),
        sa.ForeignKeyConstraint(["record_id"], ["training_records.id"], name="notes_record_id_fkey", ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], name="notes_user_id_fkey", ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_notes_record_id", "notes", ["record_id"], unique=False)
    op.create_table(
        "note_comments",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("note_id", sa.Integer(), sa.ForeignKey("notes.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.now()),
        sa.PrimaryKeyConstraint("id"),
    )
```

- [ ] 生成迁移并覆写为上述代码，移入 `ddl/`
- [ ] `cd backend && uv run alembic upgrade head`
- [ ] `cd backend && uv run alembic downgrade -1`
- [ ] `cd backend && uv run alembic upgrade head`（roundtrip 验证通过）
- [ ] Commit：`🗃️ db: drop notes/note_comments 表（学习笔记移除）`

### 3c：数据迁移 — 删除 record_notes 权限

```bash
cd backend && uv run alembic revision -m "remove_record_notes_permission"
```

手工编写，移入 `data/`：

```python
"""remove_record_notes_permission

# Manual override reason: data_only

从 role_permissions 中删除 record_notes 权限项。

Revision ID: <auto>
Revises: <head_at_time>
Create Date: <auto>
"""

from typing import Sequence, Union
import sqlalchemy as sa
from alembic import op

revision: str = "<auto>"
down_revision: Union[str, Sequence[str], None] = "<auto>"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.get_bind().execute(
        sa.text("DELETE FROM role_permissions WHERE permission = 'record_notes'")
    )


def downgrade() -> None:
    bind = op.get_bind()
    role_names = ["super_admin", "admin", "teacher"]
    for name in role_names:
        bind.execute(
            sa.text(
                "INSERT INTO role_permissions (role_id, permission) "
                "SELECT id, 'record_notes' FROM roles WHERE name = :n AND is_system = true "
                "AND NOT EXISTS ("
                "  SELECT 1 FROM role_permissions rp "
                "  WHERE rp.role_id = roles.id AND rp.permission = 'record_notes'"
                ")"
            ),
            {"n": name},
        )
```

- [ ] 创建 data 迁移并覆写为上述代码
- [ ] `cd backend && uv run alembic upgrade head`
- [ ] `cd backend && uv run alembic downgrade -1`
- [ ] `cd backend && uv run alembic upgrade head`
- [ ] 验证：`cd backend && uv run python -c "from core.roles import SYSTEM_PERMISSIONS; print('record_notes' in str(SYSTEM_PERMISSIONS))"`（应输出 False 或跑完不报错——但 roles.py 已改见下方）
- [ ] Commit：`🗃️ db: 删除 record_notes 权限（学习笔记移除）`

### 3d：权限源头清理 + 再生前端权限词表

- [ ] `backend/core/permissions.py:35`：删 `PermissionDef("record_notes", "训练批注"),`
- [ ] `backend/core/roles.py:18,33,46`：3 处删 `"record_notes",`
- [ ] `cd backend && uv run ruff check`
- [ ] Commit：`🔥 remove: 从权限系统移除 record_notes`
- [ ] 仓库根：`pnpm run api:update`（再生 `permissions.gen.ts` + `api-types.gen.ts` + `capabilities.gen.ts`）
- [ ] Commit：`📦 build: 同步 .gen.ts（移除 record_notes + 笔记/阶段/微信 API 类型）`

---

## 任务 4：收尾验证

- [ ] **残留 grep — 活动代码零残留**（排除 `migrations/versions/`、`docs/`、`*.gen.ts`）：

```bash
# 阶段系统
rg "advance-phase|advance_phase" --glob '!migrations/versions/**' --glob '!docs/**' --glob '!*.gen.ts'
rg "current_phase" --glob '!migrations/versions/**' --glob '!docs/**' --glob '!*.gen.ts'
rg "PhaseConfig|PhaseAdvance|phase_guard|phase_transition" --glob '!migrations/versions/**' --glob '!docs/**' --glob '!*.gen.ts' --glob '!*.md'

# 微信
rg "wechat|WeChat|WECHAT" --glob '!migrations/versions/**' --glob '!docs/**' --glob '!*.gen.ts' --glob '!*.md'
# 注意：models/auth.py 的 wechat_openid 列预期仍在（保留）

# 学习笔记
rg "/notes|notes\.ts|NotesCard|NoteEditor" --glob '!migrations/versions/**' --glob '!docs/**' --glob '!*.gen.ts' --glob '!*.md'
rg "from.*notes import|import.*notes" --glob '!migrations/versions/**' --glob '!docs/**' --glob '!*.gen.ts' --glob '!*.md'
# 注意：profiles/history_taking/notes.py 保留（NoteSource，非学习笔记）
```

以上全部期望**空结果**（或仅 `models/auth.py:49 wechat_openid` 行 + `profiles/history_taking/notes.py` 保留）。

- [ ] **全量检查**：

```bash
# 后端
cd backend && uv run ruff check && uv run ruff format && uv run ty check
cd backend && uv run python -m pytest -x -q

# 前端
cd frontend && npx tsc --noEmit && npx biome check
```

- [ ] **alembic roundtrip**：
```bash
cd backend && uv run alembic downgrade base && uv run alembic upgrade head
```

> 注意：downgrade base 会删所有表，仅限本地测试库；需要 `uv run alembic upgrade head` 恢复。

- [ ] **手测清单**：
  1. 登录（密码登录正常，微信登录端点 404）
  2. 开始训练 → 患者打招呼正常
  3. 发送消息 → 患者回复正常（pipeline 无 phase 中间件后仍正常运行）
  4. 结束训练 → 评分正常触发
  5. 查看训练记录详情 → 无 current_phase / notes 字段
  6. 管理端 → 权限列表无 record_notes
  7. 患者主动对话（patient_initiative）→ 情感指示器正常触发

---

## 删除顺序说明（避免中间 commit import 报错）

| Order | Commit | 系统可启动 | 测试可跑 |
|-------|--------|-----------|---------|
| 1 | 🔥 remove: 微信后端登录 | ✅（微信端点消失但系统不依赖它们） | ✅ |
| 2a | 🔥 remove: 阶段系统代码 | ✅（删 phase 中间件但 GUARD/TRANSITION 空槽无实际效果；persister 删 phase_op_count 后完全独立） | ✅ |
| 2b | 🗃️ db: drop current_phase | ✅（模型列和迁移同步删除） | ✅ |
| 3a | 🔥 remove: 学习笔记功能 | ✅（notes 功能独立，不影响核心管道） | ✅ |
| 3b | 🗃️ db: drop notes 表 | ✅ | ✅ |
| 3c | 🗃️ db: 删 record_notes 权限 | ✅ | ✅ |
| 3d | 🔥 remove: 权限源头 + 📦 api:update | ✅ | ✅ |
| 4 | 收尾验证 | ✅ | ✅ |

每个 commit 点保证 `import` 不报错、系统可启动。迁移 commit 需先改模型再跑 alembic，顺序为：删模型列 → autogenerate 迁移 → 手工覆写 upgrade/downgrade → upgrade head → 验证。

---

## 自检结果

- ✅ 覆盖 spec 2.1~2.3 全部条目
- ✅ 零占位符（所有文件路径、行号、代码内容精确列出）
- ✅ 两个待决问题已调查并给出处置方案
- ✅ `profiles/history_taking/notes.py` 确认不删（NoteSource，非学习笔记）
- ✅ progress.py 改为部分删减（保留 initiative/trigger 端点）
- ✅ 权限源头（permissions.py + roles.py）+ 数据迁移 + api:update 三条线覆盖
- ✅ 迁移 downgrade 完整可逆
- ✅ 删除顺序保证中间 commit 无 import 报错
- ✅ 残留 grep 命令精确给出（含排除路径）
