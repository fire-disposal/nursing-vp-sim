# Tier 0 Critical BUG 修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 spec 中 Tier 0 三项 Critical 缺陷——评分超时/状态机数据损坏、训练选择页搜索失效、登录按钮无提交中状态。

**Architecture:** 后端评分修复围绕"统一超时预算 + Score 存在性守卫 + 收紧重试 SQL"三点，改动集中在 `scoring.py` / `session.py` / `main.py` / `config.py`，用 pytest 覆盖状态机分支。搜索修复需后端 `list_cases` 增加 `name` 参数（贯穿 router→service→repository）+ 重新生成 API 类型 + 前端接线去抖搜索。登录修复将 `useRef` 提交态改为 `useState`。

**Tech Stack:** 后端 FastAPI + SQLAlchemy + pytest（`uv run` from `backend/`）；前端 React 19 + TanStack Query + Vitest + Testing Library（`pnpm`/`npx` from `frontend/`）。

**关联 spec:** `docs/superpowers/specs/2026-07-10-bugfix-roadmap-design.md`（T0-1 / T0-2 / T0-3）

---

## File Structure

- **T0-1（评分状态机）**
  - Modify: `backend/core/config.py` — 新增派生超时常量与统一注释
  - Modify: `backend/contexts/training/router/scoring.py` — Score 存在性守卫、超时提示文案、retry 守卫窗口
  - Modify: `backend/contexts/training/router/session.py:52-81` — 收紧 `allow_retry` SQL
  - Modify: `backend/main.py:79-108` — 启动恢复加 Score 守卫
  - Create: `backend/tests/scoring/test_scoring_lifecycle.py` — 状态机分支测试
- **T0-2（搜索）**
  - Modify: `backend/repositories/case.py:12-27` — `list_brief` 加 `name`
  - Modify: `backend/services/case.py:77-85` — 透传 `name`
  - Modify: `backend/routers/cases.py:74-89` — `list_cases` 加 `name` Query 参数
  - Modify: `backend/tests/`（新增或既有 cases 测试）— repo 层 `name` 过滤测试
  - Regenerate: `frontend/src/api/api-types.gen.ts`（`pnpm run api:update:all`，勿手改）
  - Modify: `frontend/src/pages/TrainingSelect.tsx` — 去抖搜索接线
- **T0-3（登录）**
  - Modify: `frontend/src/pages/Login.tsx:44-93` — `useState` 提交态
  - Create: `frontend/src/__tests__/Login.test.tsx` — 提交态测试

---

## T0-1 评分状态机数据损坏修复

**根因回顾：** ① 外层超时 180s 远小于 LLM 重试包络（per-attempt 130s×多次），重试永不生效；② `evaluate_training` 内已 commit 的 `Score` 在超时/失败/启动恢复路径被标 `failed`，产生孤儿 Score；③ `180`(config)/`300`(retry 守卫)/"超过5分钟"(文案) 三处不一致，且 `allow_retry` SQL 含 `processing` 是未来隐患。

### Task 1: 统一超时预算常量

**Files:**
- Modify: `backend/core/config.py:109-112`

- [ ] **Step 1: 在 config.py 增加派生常量与说明**

在 `backend/core/config.py` 第 111 行 `SCORING_TIMEOUT_SECONDS` 定义之后（第 112 行 `CLEANUP_INTERVAL_SECONDS` 之前）插入：

```python
# retry_scoring 判定"评分仍在进行中"的宽限窗口 —— 必须 >= SCORING_TIMEOUT_SECONDS，
# 否则会出现"任务已超时标 failed，但守卫仍认为在进行中"或"任务仍在跑却被重试抢占"的错配。
# 取值 = 全局评分超时 + 30s 缓冲。是超时/守卫/文案的单一来源。
SCORING_RETRY_GRACE_SECONDS = SCORING_TIMEOUT_SECONDS + 30
```

- [ ] **Step 2: 验证 import 可用**

Run: `cd backend; uv run python -c "from core.config import SCORING_TIMEOUT_SECONDS, SCORING_RETRY_GRACE_SECONDS; print(SCORING_TIMEOUT_SECONDS, SCORING_RETRY_GRACE_SECONDS)"`
Expected: 输出 `180 210`

- [ ] **Step 3: Commit**

```bash
git add backend/core/config.py
git commit -m "🔧 chore: 新增 SCORING_RETRY_GRACE_SECONDS 统一评分超时预算"
```

---

### Task 2: 抽取 Score 存在性守卫 helper（TDD）

将"记录标记完成/失败前先看 Score 是否已存在"的逻辑抽成纯 helper，供 `_run_scoring_background`、`_handle_scoring_failure`、`main.py` 恢复三处复用。

**Files:**
- Modify: `backend/contexts/training/router/scoring.py`（新增 helper）
- Create: `backend/tests/scoring/test_scoring_lifecycle.py`

- [ ] **Step 1: 写失败测试**

创建 `backend/tests/scoring/test_scoring_lifecycle.py`：

```python
"""状态机守卫测试：已有 Score 的记录不得被标 failed。"""

import pytest

from contexts.training.router.scoring import _resolve_terminal_status
from models import Case, Score, TrainingRecord


@pytest.fixture
def record_with_score(db_session):
    case = Case(name="测试病例", training_type="history_taking", difficulty=1, case_data={})
    db_session.add(case)
    db_session.flush()
    rec = TrainingRecord(
        user_id=1,
        case_id=case.id,
        training_type="history_taking",
        status="completed",
        scoring_status="processing",
    )
    db_session.add(rec)
    db_session.flush()
    score = Score(
        record_id=rec.id,
        total_score=80,
        detail_scores={},
        strengths=["a"],
        weaknesses=["b"],
        missed_content=["c"],
        suggestions="d",
        rubric_version="v1",
        prompt_version=0,
        score_scale=100,
    )
    db_session.add(score)
    db_session.flush()
    return rec


def test_resolve_terminal_status_completed_when_score_exists(db_session, record_with_score):
    status = _resolve_terminal_status(db_session, record_with_score.id, intended="failed")
    assert status == "completed"


def test_resolve_terminal_status_keeps_failed_when_no_score(db_session):
    case = Case(name="无分病例", training_type="history_taking", difficulty=1, case_data={})
    db_session.add(case)
    db_session.flush()
    rec = TrainingRecord(
        user_id=1, case_id=case.id, training_type="history_taking",
        status="completed", scoring_status="processing",
    )
    db_session.add(rec)
    db_session.flush()
    status = _resolve_terminal_status(db_session, rec.id, intended="failed")
    assert status == "failed"
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd backend; uv run python -m pytest tests/scoring/test_scoring_lifecycle.py -x -q`
Expected: FAIL — `ImportError: cannot import name '_resolve_terminal_status'`

- [ ] **Step 3: 实现 helper**

在 `backend/contexts/training/router/scoring.py` 中，`_handle_scoring_failure` 函数定义（第 129 行）之前插入：

```python
def _resolve_terminal_status(db: Session, record_id: int, *, intended: str) -> str:
    """若记录已存在有效 Score，则终态强制为 'completed'，避免孤儿 Score + failed。

    intended 为调用方本想设置的终态（通常 'failed'）。仅当无 Score 时才沿用。
    """
    has_score = db.query(Score.id).filter(Score.record_id == record_id).first() is not None
    if has_score:
        return "completed"
    return intended
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd backend; uv run python -m pytest tests/scoring/test_scoring_lifecycle.py -x -q`
Expected: PASS（2 passed）

- [ ] **Step 5: Commit**

```bash
git add backend/contexts/training/router/scoring.py backend/tests/scoring/test_scoring_lifecycle.py
git commit -m "✨ feat: 抽取 _resolve_terminal_status 守卫，防止孤儿 Score 被标 failed"
```

---

### Task 3: 在失败处理中应用 Score 守卫

**Files:**
- Modify: `backend/contexts/training/router/scoring.py:143-147`

- [ ] **Step 1: 修改 `_handle_scoring_failure`**

将 `backend/contexts/training/router/scoring.py` 第 143-147 行：

```python
            record = db.query(TrainingRecord).filter(TrainingRecord.id == record_id).first()
            if record and record.scoring_status == "processing":
                record.scoring_status = "failed"
                record.scoring_error = error_msg[:2000]
                db.commit()
```

改为：

```python
            record = db.query(TrainingRecord).filter(TrainingRecord.id == record_id).first()
            if record and record.scoring_status == "processing":
                terminal = _resolve_terminal_status(db, record_id, intended="failed")
                record.scoring_status = terminal
                record.scoring_error = None if terminal == "completed" else error_msg[:2000]
                db.commit()
                if terminal == "completed":
                    log.info("评分超时但已存在有效 Score，纠正为 completed", extra={"record_id": record_id})
                    return
```

> 注：`return` 在 `try` 内，`finally: db.close()`（第 168-169 行）仍会执行，无泄漏。已有 Score 时跳过"评分失败"通知与 SSE。

- [ ] **Step 2: 写失败处理集成测试**

在 `backend/tests/scoring/test_scoring_lifecycle.py` 末尾追加：

```python
def test_handle_scoring_failure_corrects_to_completed_when_score_exists(db_session, record_with_score, monkeypatch):
    from contexts.training.router import scoring as scoring_mod

    monkeypatch.setattr(scoring_mod, "SessionLocal", lambda: db_session)
    monkeypatch.setattr(db_session, "close", lambda: None)

    scoring_mod._handle_scoring_failure(record_with_score.id, "评分超时")

    db_session.expire_all()
    rec = db_session.query(TrainingRecord).filter(TrainingRecord.id == record_with_score.id).first()
    assert rec.scoring_status == "completed"
    assert rec.scoring_error is None
```

- [ ] **Step 3: 运行测试**

Run: `cd backend; uv run python -m pytest tests/scoring/test_scoring_lifecycle.py -x -q`
Expected: PASS（3 passed）

- [ ] **Step 4: Commit**

```bash
git add backend/contexts/training/router/scoring.py backend/tests/scoring/test_scoring_lifecycle.py
git commit -m "🐛 fix: 评分超时若已有 Score 则纠正为 completed 而非 failed"
```

---

### Task 4: 启动恢复应用 Score 守卫

**Files:**
- Modify: `backend/main.py:87-98`

- [ ] **Step 1: 修改 `_recover_stuck_scoring_records`**

将 `backend/main.py` 第 87-98 行：

```python
        stuck = (
            db.query(TrainingRecord)
            .filter(
                TrainingRecord.scoring_status.in_(["pending", "processing"]),
                TrainingRecord.status == "completed",
            )
            .all()
        )
        for rec in stuck:
            rec.scoring_status = "failed"
            rec.scoring_error = "服务重启导致评分中断，请点击重新评分"
        db.commit()
```

改为：

```python
        from models import Score

        stuck = (
            db.query(TrainingRecord)
            .filter(
                TrainingRecord.scoring_status.in_(["pending", "processing"]),
                TrainingRecord.status == "completed",
            )
            .all()
        )
        scored_ids = {
            r[0]
            for r in db.query(Score.record_id)
            .filter(Score.record_id.in_([rec.id for rec in stuck]))
            .all()
        } if stuck else set()
        for rec in stuck:
            if rec.id in scored_ids:
                rec.scoring_status = "completed"
                rec.scoring_error = None
            else:
                rec.scoring_status = "failed"
                rec.scoring_error = "服务重启导致评分中断，请点击重新评分"
        db.commit()
```

- [ ] **Step 2: 写恢复测试**

在 `backend/tests/scoring/test_scoring_lifecycle.py` 末尾追加：

```python
def test_recovery_marks_completed_when_score_exists(db_session, record_with_score, monkeypatch):
    import main

    monkeypatch.setattr(main, "SessionLocal", lambda: db_session)
    monkeypatch.setattr(db_session, "close", lambda: None)

    main._recover_stuck_scoring_records()

    db_session.expire_all()
    rec = db_session.query(TrainingRecord).filter(TrainingRecord.id == record_with_score.id).first()
    assert rec.scoring_status == "completed"
```

> 若 `main` 顶层 import 有副作用导致测试环境无法直接 import，改为在测试内 `from main import _recover_stuck_scoring_records` 并同样 monkeypatch `main.SessionLocal`；仍失败则将该测试标 `@pytest.mark.skip(reason="main import 副作用，逻辑已由 test_resolve_terminal_status 覆盖")` 并在 commit message 注明。

- [ ] **Step 3: 运行测试**

Run: `cd backend; uv run python -m pytest tests/scoring/test_scoring_lifecycle.py -x -q`
Expected: PASS（4 passed，或 3 passed + 1 skipped）

- [ ] **Step 4: Commit**

```bash
git add backend/main.py backend/tests/scoring/test_scoring_lifecycle.py
git commit -m "🐛 fix: 启动恢复对已有 Score 的记录置 completed 而非 failed"
```

---

### Task 5: 统一 retry 守卫窗口与文案，收紧 allow_retry SQL

**Files:**
- Modify: `backend/contexts/training/router/scoring.py:262-271,376-378`
- Modify: `backend/contexts/training/router/session.py:64-73`

- [ ] **Step 1: 修正超时提示文案（两处）**

`backend/contexts/training/router/scoring.py` 第 265 行 `tracker.update(record_id, "failed", 0, "评分超时（超过5分钟）")` 与第 268 行 `"评分超时（超过5分钟）"`：将两处字面量替换为动态文案。在文件顶部确认已 `from core.config import SCORING_TIMEOUT_SECONDS`（若无则加入 import），并把两处改为：

```python
        _timeout_msg = f"评分超时（超过{SCORING_TIMEOUT_SECONDS}秒）"
```

即第 262-271 行的 `except TimeoutError:` 块改为：

```python
    except TimeoutError:
        log.exception("[SCORING] TIMEOUT record_id=%d", record_id)
        _timeout_msg = f"评分超时（超过{SCORING_TIMEOUT_SECONDS}秒）"
        if tracker:
            tracker.update(record_id, "failed", 0, _timeout_msg)
        _handle_scoring_failure(
            record_id,
            _timeout_msg,
            tracker=tracker,
            realtime_hub=realtime_hub,
        )
```

- [ ] **Step 2: retry 守卫窗口改用配置常量**

`backend/contexts/training/router/scoring.py` 第 377 行：

```python
            if record.end_time and (now - ensure_utc(record.end_time)).total_seconds() <= 300:
```

改为（先在顶部 import 增加 `SCORING_RETRY_GRACE_SECONDS`）：

```python
            if record.end_time and (now - ensure_utc(record.end_time)).total_seconds() <= SCORING_RETRY_GRACE_SECONDS:
```

- [ ] **Step 3: 收紧 `allow_retry` SQL WHERE**

`backend/contexts/training/router/session.py` 第 69 行：

```python
                "  scoring_status IS NULL OR scoring_status IN ('completed', 'failed', 'pending', 'processing')"
```

改为：

```python
                "  scoring_status IS NULL OR scoring_status IN ('completed', 'failed')"
```

并将该函数 docstring 第 59-60 行的 `从任何可重试状态获取` 更新为 `从 NULL/completed/failed 获取（不抢占进行中的 pending/processing）`。

- [ ] **Step 4: 编译 + 相关测试回归**

Run: `cd backend; uv run python -m compileall -q contexts/training/router/scoring.py contexts/training/router/session.py; uv run python -m pytest tests/scoring/ -x -q`
Expected: 编译无输出（成功）；scoring 测试全绿

- [ ] **Step 5: Commit**

```bash
git add backend/contexts/training/router/scoring.py backend/contexts/training/router/session.py
git commit -m "🐛 fix: 统一评分超时窗口与文案，retry 不再抢占进行中记录"
```

---

### Task 6: T0-1 收尾校验

- [ ] **Step 1: 后端全域检查**

Run: `cd backend; uv run ruff check; uv run ruff format; uv run ty check; uv run python -m pytest tests/scoring/ -x -q`
Expected: ruff 无错误、format 无改动残留、ty 通过、scoring 测试全绿

- [ ] **Step 2: 若 format 有改动则补提交**

```bash
git add -A backend/
git commit -m "🎨 style: ruff format 评分修复相关文件"
```

---

## T0-2 训练选择页搜索修复

**根因回顾：** 学生端 `/cases`（`list_cases`）后端不支持 `name` 搜索，`queryKey` 含 `search` 但从未传参。需后端补 `name` 参数 + 重新生成类型 + 前端去抖接线。

### Task 7: 后端 `list_brief` 支持 `name`（TDD）

**Files:**
- Modify: `backend/repositories/case.py:12-27`
- Modify: `backend/services/case.py:77-85`
- Modify: `backend/routers/cases.py:74-89`
- Test: `backend/tests/`（新增 `backend/tests/cases/test_case_list_brief.py`）

- [ ] **Step 1: 写失败测试**

创建 `backend/tests/cases/test_case_list_brief.py`：

```python
"""list_brief 的 name 模糊搜索测试。"""

import pytest

from models import Case
from repositories.case import CaseRepository


@pytest.fixture
def three_cases(db_session):
    for nm in ("急性胸痛", "腹痛待查", "胸闷气短"):
        db_session.add(Case(name=nm, training_type="history_taking", difficulty=1, case_data={}))
    db_session.flush()


def test_list_brief_filters_by_name(db_session, three_cases):
    repo = CaseRepository(db_session)
    items, total = repo.list_brief(0, 50, name="胸")
    names = {c.name for c in items}
    assert total == 2
    assert names == {"急性胸痛", "胸闷气短"}


def test_list_brief_no_name_returns_all(db_session, three_cases):
    repo = CaseRepository(db_session)
    _items, total = repo.list_brief(0, 50)
    assert total == 3
```

> 若 `backend/tests/cases/` 目录不存在，先创建它（与既有 `tests/scoring/` 同级）。

- [ ] **Step 2: 运行测试确认失败**

Run: `cd backend; uv run python -m pytest tests/cases/test_case_list_brief.py -x -q`
Expected: FAIL — `TypeError: list_brief() got an unexpected keyword argument 'name'`

- [ ] **Step 3: repository 加 `name`**

`backend/repositories/case.py` 第 12-27 行 `list_brief` 改为：

```python
    def list_brief(
        self,
        offset: int,
        limit: int,
        *,
        training_type: str | None = None,
        difficulty: int | None = None,
        name: str | None = None,
    ) -> tuple[list[Case], int]:
        q = self.db.query(Case).order_by(Case.id)
        if training_type:
            q = q.filter(Case.training_type == training_type)
        if difficulty is not None:
            q = q.filter(Case.difficulty == difficulty)
        if name:
            q = q.filter(Case.name.ilike(f"%{name}%"))
        total = q.order_by(None).count()
        items = q.offset(offset).limit(limit).all()
        return items, total
```

- [ ] **Step 4: service 透传 `name`**

`backend/services/case.py` 第 77-85 行 `list_brief` 改为：

```python
    def list_brief(
        self,
        offset: int,
        limit: int,
        *,
        training_type: str | None = None,
        difficulty: int | None = None,
        name: str | None = None,
    ) -> tuple[list[Case], int]:
        return self.repo.list_brief(
            offset, limit, training_type=training_type, difficulty=difficulty, name=name
        )
```

- [ ] **Step 5: router 加 `name` Query 参数**

`backend/routers/cases.py` 第 74-89 行 `list_cases` 改为：

```python
@router.get("", response_model=PaginatedResponse[CaseBrief])
def list_cases(
    db: DbSession,
    current_user: CurrentUser,
    offset: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    training_type: Annotated[str | None, Query(description="训练类型 history_taking/triage")] = None,
    difficulty: Annotated[int | None, Query(ge=1, le=3, description="困难程度 1=初级 2=中级 3=高级")] = None,
    name: Annotated[str | None, Query(description="病例名称模糊搜索")] = None,
):
    items, total = CaseService(db).list_brief(
        offset, limit, training_type=training_type, difficulty=difficulty, name=name
    )
    return PaginatedResponse(
        items=[_to_case_brief(c) for c in items],
        total=total,
        offset=offset,
        limit=limit,
    )
```

- [ ] **Step 6: 运行测试确认通过**

Run: `cd backend; uv run python -m pytest tests/cases/test_case_list_brief.py -x -q`
Expected: PASS（2 passed）

- [ ] **Step 7: 后端检查 + Commit**

Run: `cd backend; uv run ruff check; uv run ty check`
Expected: 通过

```bash
git add backend/repositories/case.py backend/services/case.py backend/routers/cases.py backend/tests/cases/test_case_list_brief.py
git commit -m "✨ feat: /cases 列表支持 name 模糊搜索"
```

---

### Task 8: 重新生成 API 类型

**Files:**
- Regenerate: `openapi.json`, `frontend/src/api/api-types.gen.ts`, `frontend/src/engine/capabilities.gen.ts`

- [ ] **Step 1: 运行生成命令**

Run（从 monorepo 根目录）: `pnpm run api:update:all`
Expected: 生成成功，`git diff --stat` 显示 `openapi.json` 与 `api-types.gen.ts` 有改动（新增 cases `name` query 参数）

- [ ] **Step 2: 校验同步**

Run: `pnpm run check:api`
Expected: 通过（无未同步差异）

- [ ] **Step 3: Commit**

```bash
git add openapi.json frontend/src/api/api-types.gen.ts frontend/src/engine/capabilities.gen.ts
git commit -m "🔧 chore: 重新生成 API 类型（cases name 搜索参数）"
```

---

### Task 9: 前端 TrainingSelect 接线去抖搜索

**Files:**
- Modify: `frontend/src/pages/TrainingSelect.tsx:1-90,185`

- [ ] **Step 1: 引入 useDebouncedSearch，替换 search state**

`frontend/src/pages/TrainingSelect.tsx` 第 3 行 import 后，第 8 行左右已有 hooks import 区，新增：

```typescript
import { useDebouncedSearch } from "@/hooks/useDebouncedSearch";
```

删除第 67 行 `const [search, setSearch] = useState("");`，替换为：

```typescript
  const { searchInput, debouncedValue: search, handleSearchChange } = useDebouncedSearch("", 300);
```

- [ ] **Step 2: 把 search 传入 getCases，并在 search 变化时重置 offset**

第 80-90 行 `useQuery` 改为：

```typescript
  const { data: casesData, isLoading, isError } = useQuery({
    queryKey: queryKeys.cases.list({ type: selectedType, difficulty: difficultyFilter, offset, search }),
    queryFn: () =>
      getCases({
        offset,
        limit: LIMIT,
        ...(selectedType ? { training_type: selectedType } : {}),
        ...(difficultyFilter > 0 ? { difficulty: difficultyFilter } : {}),
        ...(search ? { name: search } : {}),
      }).then((r) => r.data),
    staleTime: 5 * 60_000,
  });
```

- [ ] **Step 3: 搜索输入框改用去抖 handler**

第 185 行搜索框 `value`/`onChange`（原绑定 `search`/`setSearch`）改为绑定 `searchInput`/`handleSearchChange`：

```typescript
                value={searchInput}
                onChange={(e) => {
                  handleSearchChange(e.target.value);
                  setOffset(0);
                }}
```

> 确认第 185 行附近 `<input>`/`<Input>` 的 `value`、`onChange` 属性名与上文一致；若使用受控组件包装，按其 API 调整。

- [ ] **Step 4: 类型检查 + lint**

Run: `cd frontend; npx tsc --noEmit; npx biome check src/pages/TrainingSelect.tsx`
Expected: 无错误

- [ ] **Step 5: 手动验证**

Run: `pnpm run dev`（或前端单独启动），登录后进入训练选择页，在搜索框输入病例名关键字。
Expected: 列表按后端返回结果过滤；连续击键 300ms 内只发一次请求（DevTools Network 确认）；清空搜索恢复全部。

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/TrainingSelect.tsx
git commit -m "🐛 fix: 训练选择页搜索接入后端 name 参数并去抖"
```

---

## T0-3 登录按钮提交中状态修复

**根因回顾：** `submittingRef = useRef` 读写不触发重渲染，`isSubmitting` 永远为初始值，按钮 loading 文案/禁用态失效。

### Task 10: 登录提交态改为 useState（TDD）

**Files:**
- Modify: `frontend/src/pages/Login.tsx:44-93`
- Create: `frontend/src/__tests__/Login.test.tsx`

- [ ] **Step 1: 写失败测试**

创建 `frontend/src/__tests__/Login.test.tsx`：

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import Login from "@/pages/Login";

const loginMock = vi.fn();
vi.mock("@/stores/authStore", () => ({
  useAuthStore: (selector: (s: unknown) => unknown) =>
    selector({ login: loginMock, user: null, token: null }),
}));

function renderLogin() {
  return render(
    <MemoryRouter>
      <Login />
    </MemoryRouter>,
  );
}

describe("Login submit state", () => {
  it("shows loading label while submitting", async () => {
    let resolveLogin: () => void = () => {};
    loginMock.mockImplementation(() => new Promise<void>((res) => { resolveLogin = res; }));
    const user = userEvent.setup();
    renderLogin();

    await user.type(screen.getByPlaceholderText("用户名"), "alice");
    await user.type(screen.getByPlaceholderText("密码"), "secret123");
    await user.click(screen.getByRole("button", { name: "登 录" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "登录中..." })).toBeDisabled());
    resolveLogin();
  });
});
```

> 若既有测试的 auth store mock 形态不同，参照 `frontend/src/__tests__/authStore.test.ts` 与 `setup.ts` 的约定调整 mock；保留断言"提交中按钮显示'登录中...'且 disabled"。

- [ ] **Step 2: 运行测试确认失败**

Run: `cd frontend; npx vitest run src/__tests__/Login.test.tsx`
Expected: FAIL — 按钮始终为"登 录"，找不到"登录中..."或未 disabled

- [ ] **Step 3: 改用 useState**

`frontend/src/pages/Login.tsx` 第 45 行 `const submittingRef = useRef(false);` 删除，第 44 行后新增：

```typescript
	const [isSubmitting, setIsSubmitting] = useState(false);
```

第 73-91 行 `onSubmit` 改为：

```typescript
	const onSubmit = async (values: LoginFormValues) => {
		if (isSubmitting) return;
		setIsSubmitting(true);
		setError("");
		try {
			await login(values.username, values.password);
			if (mountedRef.current) {
				navigate("/home", { replace: true });
			}
		} catch (err: unknown) {
			if (mountedRef.current) {
				setError(extractError(err));
			}
		} finally {
			if (mountedRef.current) {
				setIsSubmitting(false);
			}
		}
	};
```

删除第 93 行 `const isSubmitting = submittingRef.current;`（已由 useState 提供）。确认 `useState` 已在第 3 行 React import 中（`useRef` 若不再被使用则从 import 移除，避免 biome 未使用告警）。

- [ ] **Step 4: 运行测试确认通过**

Run: `cd frontend; npx vitest run src/__tests__/Login.test.tsx`
Expected: PASS（1 passed）

- [ ] **Step 5: 类型检查 + lint**

Run: `cd frontend; npx tsc --noEmit; npx biome check src/pages/Login.tsx`
Expected: 无错误（含无未使用的 `useRef`）

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/Login.tsx frontend/src/__tests__/Login.test.tsx
git commit -m "🐛 fix: 登录按钮正确显示提交中状态"
```

---

## 阶段收尾 Checkpoint

- [ ] **Step 1: 后端完整检查**

Run: `cd backend; uv run python -m compileall -q .; uv run python -m pytest tests/scoring/ tests/cases/ -x -q; uv run ruff check; uv run ruff format; uv run ty check`
Expected: 全绿

- [ ] **Step 2: 前端完整检查**

Run: `cd frontend; npx tsc --noEmit; npx biome check; npx vitest run`
Expected: 全绿

- [ ] **Step 3: 汇报**

三项 Tier 0 修复完成，等待用户确认后进入 Tier 1 计划（另立 plan 文档）。

---

## Self-Review 结论

- **Spec 覆盖**：T0-1 → Task 1-6；T0-2 → Task 7-9；T0-3 → Task 10。三项验收标准均有对应任务与测试。
- **Placeholder**：无 TBD/TODO；每个代码步骤含完整代码。
- **类型一致性**：`_resolve_terminal_status` 签名在 Task 2 定义、Task 3/4 复用一致；`SCORING_RETRY_GRACE_SECONDS`（Task 1）在 Task 5 引用；`list_brief(name=...)` 在 repo/service/router/前端四处签名一致。
- **风险标注**：Task 4 恢复测试的 import 副作用回退方案、Task 9/10 前端受控组件属性名与 mock 形态的核对提示已就地写明。
