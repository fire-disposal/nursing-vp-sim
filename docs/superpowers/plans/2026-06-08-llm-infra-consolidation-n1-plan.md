# LLM Infrastructure Consolidation & N+1 Elimination Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate infrastructure duplication in scoring (share app-level ProfileRouter, PromptManager, httpx_client, LogWorker) and remove all 7 N+1 query patterns across the backend.

**Architecture:** Convert `_run_scoring_background` to async function that accepts shared infrastructure references; settlement loop calls it via asyncio.create_task instead of threading.Thread. N+1 fixes use GROUP BY aggregation and joinedload eager loading.

**Tech Stack:** Python 3.13, FastAPI, SQLAlchemy 2.0, pytest

---

### Task 1: Create shared LLM infrastructure module

**Files:**
- Create: `backend/services/llm/infra.py`

- [ ] **Step 1: Write `backend/services/llm/infra.py`**

```python
"""Shared LLM infrastructure — module-level references to app-state objects.

Set during app startup. Used by both request handlers (via app.state) and
background tasks (via these module-level refs). Background tasks import
these instead of creating duplicate infrastructure instances.
"""

import httpx

from services.llm.log_worker import LogWorker
from services.llm.router import ProfileRouter
from services.prompt.manager import PromptManager

_client: httpx.AsyncClient | None = None
_router: ProfileRouter | None = None
_pm: PromptManager | None = None
_log_worker: LogWorker | None = None
_lock: "asyncio.Lock | None" = None
_loop_id: int | None = None


def set_infra(
    client: httpx.AsyncClient,
    router: ProfileRouter,
    pm: PromptManager,
    log_worker: LogWorker,
) -> None:
    import asyncio
    global _client, _router, _pm, _log_worker, _lock, _loop_id
    _client = client
    _router = router
    _pm = pm
    _log_worker = log_worker
    _lock = asyncio.Lock()
    _loop_id = id(asyncio.get_running_loop())


def get_client() -> httpx.AsyncClient:
    assert _client is not None, "LLM infra not initialized"
    return _client


def get_router() -> ProfileRouter:
    assert _router is not None, "LLM infra not initialized"
    return _router


def get_pm() -> PromptManager:
    assert _pm is not None, "LLM infra not initialized"
    return _pm


def get_log_worker() -> LogWorker:
    assert _log_worker is not None, "LLM infra not initialized"
    return _log_worker
```

- [ ] **Step 2: Verify syntax**

```bash
cd backend; d:/repo/dev/nursing-vp-sim/backend/.venv/Scripts/python.exe -c "from services.llm.infra import set_infra, get_client, get_router, get_pm, get_log_worker; print('OK')"
```

- [ ] **Step 3: Commit**

```bash
git add backend/services/llm/infra.py
git commit -m "♻️ refactor: add shared LLM infrastructure module for background tasks"
```

---

### Task 2: Wire infra module in app lifespan

**Files:**
- Modify: `backend/main.py:308-332`

- [ ] **Step 1: Add `set_infra()` call**

In `backend/main.py`, after the prompt_manager is loaded (line 323), and after LogWorker is started (line 332), add:

```python
        from services.llm.infra import set_infra
        set_infra(
            client=app.state.httpx_client,
            router=app.state.llm_router,
            pm=app.state.prompt_manager,
            log_worker=app.state.log_worker,
        )
        log.info("LLM infra 模块引用就绪")
```

Place it right after `log.info("LLM 日志写入器就绪")` (line 333).

- [ ] **Step 2: Commit**

```bash
git add backend/main.py
git commit -m "♻️ refactor: wire shared LLM infra into app lifespan"
```

---

### Task 3: Convert `_run_scoring_background` to async

**Files:**
- Modify: `backend/routers/training.py:122-194`

- [ ] **Step 1: Replace entire `_run_scoring_background` function**

Replace lines 122-194 with:

```python
async def _run_scoring_background(record_id: int, case_data: dict):
    from services.llm.infra import get_client, get_router, get_pm, get_log_worker

    SCORING_GLOBAL_TIMEOUT = 300

    client = get_client()
    router = get_router()
    pm = get_pm()
    log_worker = get_log_worker()

    db = SessionLocal()
    try:
        record = db.query(TrainingRecord).filter(TrainingRecord.id == record_id).first()
        if not record:
            return
        record.scoring_status = "processing"
        db.commit()

        from services.scoring import evaluate_training

        await asyncio.wait_for(
            evaluate_training(
                record_id, case_data, db,
                pm=pm,
                router=router,
                log_worker=log_worker,
                client=client,
            ),
            timeout=SCORING_GLOBAL_TIMEOUT,
        )

        record.scoring_status = "completed"
        record.scoring_error = None
        db.commit()
        log.info("评分完成", extra={"record_id": record_id, "scoring_status": "completed"})
    except TimeoutError:
        try:
            record = db.query(TrainingRecord).filter(TrainingRecord.id == record_id).first()
            if record:
                record.scoring_status = "failed"
                record.scoring_error = "评分超时（超过5分钟）"
                db.commit()
        except Exception as e:
            log.warning("评分超时后状态更新失败", extra={"record_id": record_id, "error": str(e)})
        log.exception("评分超时", extra={"record_id": record_id})
    except Exception as e:
        try:
            record = db.query(TrainingRecord).filter(TrainingRecord.id == record_id).first()
            if record:
                record.scoring_status = "failed"
                record.scoring_error = str(e)[:2000]
                db.commit()
        except Exception as inner:
            log.warning("评分失败后状态更新失败", extra={"record_id": record_id, "error": str(inner)})
        log.exception("评分失败", extra={"record_id": record_id, "error": str(e)[:200]})
    finally:
        db.close()
        _release_scoring(record_id)
```

Note: Remove the unused `import httpx` at the top of the file if no longer needed (check remaining usages).

- [ ] **Step 2: Update `end_training` trigger**

In `end_training` (line ~231), change:
```python
background_tasks.add_task(_run_scoring_background, record_id, case.case_data if case else {})
```
to:
```python
asyncio.create_task(_run_scoring_background(record_id, case.case_data if case else {}))
```

- [ ] **Step 3: Update `retry-scoring` trigger**

In `retry_scoring` (line ~278), same change:
```python
background_tasks.add_task(_run_scoring_background, record_id, case.case_data if case else {})
```
to:
```python
asyncio.create_task(_run_scoring_background(record_id, case.case_data if case else {}))
```

- [ ] **Step 4: Remove `BackgroundTasks` import if no longer used**

Check if `BackgroundTasks` is still imported and used elsewhere in training.py. If only scoring used it, remove from imports.

- [ ] **Step 5: Commit**

```bash
git add backend/routers/training.py
git commit -m "♻️ refactor: async _run_scoring_background using shared LLM infra"
```

---

### Task 4: Convert settlement to async (no threading)

**Files:**
- Modify: `backend/services/training/settlement.py`

- [ ] **Step 1: Replace threading.Thread call**

In `_cleanup_once()` (line 106-111), replace:
```python
                        t = threading.Thread(
                            target=_run_scoring_background,
                            args=(record.id, case_data),
                            daemon=True,
                        )
                        t.start()
```
with:
```python
                        asyncio.create_task(_run_scoring_background(record.id, case_data))
```

- [ ] **Step 2: Remove unused imports**

Remove `import threading` (line 4) — no longer needed.

- [ ] **Step 3: Commit**

```bash
git add backend/services/training/settlement.py
git commit -m "♻️ refactor: settlement scoring via asyncio.create_task, no threading"
```

---

### Task 5: Fix stream endpoint session lifecycle

**Files:**
- Modify: `backend/routers/chat.py`

- [ ] **Step 1: Fix session close in `send_message_stream`**

In `send_message_stream` (around line 106-111), the current code has:
```python
    except HTTPException:
        db.close()
        raise
    except Exception:
        db.close()
        raise
```

Replace with:
```python
    except HTTPException:
        db.close()
        raise
    except BaseException:
        db.close()
        raise
    finally:
        db.close()
```

This ensures db.close() runs on normal completion, not just on exceptions. Note: `finally` + explicit closure in `except` is fine because `db.close()` is idempotent.

- [ ] **Step 2: Commit**

```bash
git add backend/routers/chat.py
git commit -m "🐛 fix: ensure stream endpoint db session closed on all paths"
```

---

### Task 6: Fix N+1 — `class_summary` (GROUP BY)

**Files:**
- Modify: `backend/routers/stats.py:227-266`

- [ ] **Step 1: Replace per-class query loop with GROUP BY**

Read the current `class_summary` function. Replace the loop (approximately lines 220-268) with:

```python
@router.get("/class-summary")
def class_summary(
    current_user: Annotated[User, Depends(require_permission("stats_view"))],
    db: Annotated[Session, Depends(get_db)],
    class_id: Annotated[int | None, Query()] = None,
):
    effective_school = resolve_school_filter(current_user)

    base = db.query(Class).join(Grade, Class.grade_id == Grade.id)
    if effective_school is not None:
        base = base.filter(Grade.school_id == effective_school)
    if class_id is not None:
        base = base.filter(Class.id == class_id)

    classes = base.order_by(Class.name).all()
    class_ids = [c.id for c in classes]

    if not class_ids:
        return []

    stats_rows = (
        db.query(
            Class.id,
            func.count(func.distinct(UserClass.user_id)).label("student_count"),
            func.count(TrainingRecord.id).label("total_sessions"),
            func.coalesce(
                func.sum(
                    func.extract("epoch", TrainingRecord.end_time - TrainingRecord.start_time) / 60
                ), 0
            ).label("total_minutes"),
            func.avg(Score.total_score).label("avg_score"),
        )
        .outerjoin(UserClass, UserClass.class_id == Class.id)
        .outerjoin(
            TrainingRecord,
            (TrainingRecord.user_id == UserClass.user_id)
            & (TrainingRecord.status == "completed"),
        )
        .outerjoin(Score, Score.record_id == TrainingRecord.id)
        .filter(Class.id.in_(class_ids))
        .group_by(Class.id)
        .all()
    )

    stats_map = {row.id: row for row in stats_rows}

    result = []
    for cls in classes:
        s = stats_map.get(cls.id)
        result.append({
            "class_id": cls.id,
            "class_name": cls.name,
            "grade_id": cls.grade_id,
            "grade_name": cls.grade.name,
            "student_count": int(s.student_count) if s else 0,
            "total_sessions": int(s.total_sessions) if s else 0,
            "total_minutes": round(float(s.total_minutes), 1) if s else 0.0,
            "avg_score": round(float(s.avg_score), 1) if s and s.avg_score is not None else None,
        })

    return result
```

Note: Ensure `Class`, `Grade`, `UserClass`, `TrainingRecord`, `Score`, and `func` are imported at the top of `stats.py`. Check existing imports and add any missing ones.

- [ ] **Step 2: Commit**

```bash
git add backend/routers/stats.py
git commit -m "⚡ perf: class_summary N+1 fix — single GROUP BY instead of per-class loop"
```

---

### Task 7: Fix N+1 — `admin_roles:list_roles` (batch in_)

**Files:**
- Modify: `backend/routers/admin_roles.py:36-43`

- [ ] **Step 1: Batch-load permissions and user counts**

Replace the loop in `list_roles()`:

```python
    role_ids = [r.id for r in roles]

    all_perms = db.query(RolePermission).filter(RolePermission.role_id.in_(role_ids)).all()
    perms_map = {}
    for p in all_perms:
        perms_map.setdefault(p.role_id, []).append(p.permission)

    counts = dict(
        db.query(User.role_id, func.count(User.id))
        .filter(User.role_id.in_(role_ids))
        .group_by(User.role_id)
        .all()
    ) if role_ids else {}

    for r in roles:
        r._perms_cache = perms_map.get(r.id, [])
        r._user_count = counts.get(r.id, 0)
```

Replace the existing loop body that did per-role queries. Ensure `RolePermission` and `func` are imported.

- [ ] **Step 2: Commit**

```bash
git add backend/routers/admin_roles.py
git commit -m "⚡ perf: admin_roles N+1 fix — batch perm/user queries"
```

---

### Task 8: Fix N+1 — `questionnaires` (3 locations)

**Files:**
- Modify: `backend/routers/questionnaires.py`

Fix three N+1 patterns in this file:

- [ ] **Step 1: Fix `export_responses` — add eager loading (line ~599)**

Read the current `export_responses` function. Change the response query to:
```python
    resp_query = (
        db.query(QuestionnaireResponse)
        .options(
            joinedload(QuestionnaireResponse.user),
            joinedload(QuestionnaireResponse.answers)
                .joinedload(QuestionnaireAnswer.question),
        )
        .filter(...)
    )
```

- [ ] **Step 2: Fix `_build_response_item` — pre-load batch data (line ~432)**

Before the loop that calls `_build_response_item`, add batch queries:
```python
    response_ids = [r.id for r in rows]
    template_ids = list(set(r.template_id for r in rows))

    # Batch load all answers
    all_answers = db.query(QuestionnaireAnswer).filter(
        QuestionnaireAnswer.response_id.in_(response_ids)
    ).all()
    answers_map = {}
    for a in all_answers:
        answers_map.setdefault(a.response_id, []).append(a)

    # Batch load all questions
    all_questions = db.query(QuestionnaireQuestion).filter(
        QuestionnaireQuestion.template_id.in_(template_ids)
    ).all()
    questions_map = {}
    for q in all_questions:
        questions_map.setdefault(q.template_id, {})[q.id] = q

    # Pass pre-loaded maps to _build_response_item
    for r in rows:
        result.append(_build_response_item(r, db, answers_map, questions_map))
```

Update `_build_response_item` signature to accept the cached maps:
```python
def _build_response_item(response, db, answers_map=None, questions_map=None):
    if answers_map is not None:
        answers = answers_map.get(response.id, [])
    else:
        answers = db.query(QuestionnaireAnswer).filter(...).all()

    if questions_map is not None:
        q_map = {qid: q for qid, q in questions_map.get(response.template_id, {}).items()}
    else:
        ...
```

- [ ] **Step 3: Fix `response_stats` — batch answer query (line ~540)**

Replace the per-question loop query with:
```python
    question_ids = [qa.id for qa in questions]
    response_ids = [r.id for r in completed_responses]

    all_answers = (
        db.query(QuestionnaireAnswer.question_id, QuestionnaireAnswer.answer_value)
        .filter(
            QuestionnaireAnswer.question_id.in_(question_ids),
            QuestionnaireAnswer.response_id.in_(response_ids),
        )
        .all()
    )

    answers_by_question = {}
    for qid, val in all_answers:
        answers_by_question.setdefault(qid, []).append(val)

    for qa in questions:
        ans_values = [v for v in answers_by_question.get(qa.id, [])]
        # ... rest of processing
```

- [ ] **Step 4: Commit**

```bash
git add backend/routers/questionnaires.py
git commit -m "⚡ perf: questionnaires N+1 fix — eager loading + batch queries"
```

---

### Task 9: Fix N+1 — `settlement:_cleanup_once` (batch cases)

**Files:**
- Modify: `backend/services/training/settlement.py:82-91`

- [ ] **Step 1: Batch-load cases upfront**

Before the loop over `timeout_records` (before line 82), add:
```python
        case_ids = list(set(r.case_id for r in timeout_records))
        cases = {c.id: c for c in db.query(Case).filter(Case.id.in_(case_ids)).all()} if case_ids else {}
```

Then in the loop, replace:
```python
                case = db.query(Case).filter(Case.id == record.case_id).first()
```
with:
```python
                case = cases.get(record.case_id)
```

- [ ] **Step 2: Commit**

```bash
git add backend/services/training/settlement.py
git commit -m "⚡ perf: settlement N+1 fix — batch case lookup"
```

---

### Task 10: Fix N+1 — `get_record_detail` (eager loading + dedup)

**Files:**
- Modify: `backend/routers/training.py:369-385`

- [ ] **Step 1: Consolidate to joinedload**

Replace the 6 separate queries in `get_record_detail()` with eager loading:

```python
    record = (
        db.query(TrainingRecord)
        .options(
            joinedload(TrainingRecord.case),
            joinedload(TrainingRecord.user),
            joinedload(TrainingRecord.score),
        )
        .filter(TrainingRecord.id == record_id)
        .first()
    )
    if not record:
        raise HTTPException(status_code=404, detail="记录不存在")

    if not current_user.has_permission("score_review") and record.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="无权查看此记录")

    effective_school = resolve_school_filter(current_user)
    if effective_school is not None and (not record.user or record.user.school_id != effective_school):
        raise HTTPException(status_code=404, detail="记录不存在")

    case = record.case
    user = record.user
    score = record.score
    note_records = db.query(Note).filter(Note.record_id == record_id).order_by(Note.updated_at.desc()).all()
```

This replaces the separate queries for case, user, and score. The notes query remains separate because it has custom ordering (by `updated_at`). The redundant duplicate `user` query (line 382, same as line 377) is eliminated.

- [ ] **Step 2: Commit**

```bash
git add backend/routers/training.py
git commit -m "⚡ perf: get_record_detail N+1 fix — joinedload + dedup user query"
```

---

### Task 11: Run tests + lint

- [ ] **Step 1: Run full test suite**

```bash
d:/repo/dev/nursing-vp-sim/backend/.venv/Scripts/python.exe -m pytest d:/repo/dev/nursing-vp-sim/backend/tests/ -v --tb=short -q 2>&1 | Select-Object -Last 20
```

Expected: All tests pass (especially `test_training.py`, `test_scoring.py`, `test_auto_settlement.py`).

- [ ] **Step 2: Run ruff**

```bash
python -m ruff check d:/repo/dev/nursing-vp-sim/backend/
```

Expected: No errors.

- [ ] **Step 3: Commit any lint/test fixes**

If fixes needed, run:
```bash
git add -u
git commit -m "🐛 fix: test/lint fixes for infra consolidation + N+1"
```

---

### Task 12: Final verification

- [ ] **Step 1: Verify no threading left in scoring/settlement**

```bash
rg "threading" --include "*.py" backend/routers/training.py backend/services/training/settlement.py
```

Expected: No matches.

- [ ] **Step 2: Verify no N+1 left**

```bash
rg "db\.query.*\.filter.*\.first\(\)" --include "*.py" backend/routers/
```

No per-loop queries should remain.

---

## Verification Checklist

1. [ ] Scoring uses shared `ProfileRouter` from infra module (no `local_router = ProfileRouter()`)
2. [ ] Settlement uses `asyncio.create_task` (no `threading.Thread`)
3. [ ] `_run_scoring_background` is `async def` with no `asyncio.run()` inside
4. [ ] `class_summary` runs 1 query instead of 4C
5. [ ] `list_roles` runs 3 queries instead of 2N+1
6. [ ] All 3 questionnaire N+1 patterns fixed
7. [ ] `settlement` case lookup batched
8. [ ] `get_record_detail` 6 queries → 2 queries
9. [ ] All existing tests pass
10. [ ] `ruff check` clean
