# Pagination Standardization Design

## Goal

Standardize pagination across all list-returning API endpoints using a unified `offset/limit` + JSON body envelope pattern, and add frontend pagination UI components.

## Current State

| Endpoint | Pagination? | Style | Frontend Uses? | Risk |
|----------|------------|-------|----------------|------|
| `GET /api/training/records` | Yes | `limit/offset` + `X-Total-Count` header | No (ignores headers, shows only first 50) | HIGH |
| `GET /api/admin/llm-logs` | Yes (in-memory) | `page/page_size` + body envelope | Yes (MonitorTab) | HIGH |
| `GET /api/admin/users` | **No** | N/A | N/A | HIGH |
| `GET /api/cases` | **No** | N/A | N/A | MEDIUM |
| `GET /api/cases/manage/list` | **No** | N/A + N+1 `.count()` per case | N/A | HIGH |
| `GET /api/stats/teacher-summary` | **No** | N/A + N+1 per student | N/A | HIGH |
| `GET /api/stats/ranking` | **No** | N/A + Double N+1 per student | N/A | HIGH |
| `GET /api/stats/duration` | **No** | `.all()` all records, Python aggregate | N/A | HIGH |
| `GET /api/stats/trends` | **No** | `.all()` all records, Python aggregate | N/A | HIGH |
| `GET /api/admin/stats` | N/A | Unfiltered `.count()` + no `start_time` index | N/A | HIGH |

## Target State

All list endpoints use unified `offset/limit` + JSON body envelope.

### Standard Params

| Param | Type | Default | Min | Max |
|-------|------|---------|-----|-----|
| `offset` | int | 0 | 0 | — |
| `limit` | int | 50 | 1 | 100 |

### Standard Response

```json
{
  "items": [...],
  "total": 100,
  "offset": 0,
  "limit": 50
}
```

## Backend Changes

### 1. New unified PaginatedResponse model

Add to `backend/schemas.py`:

```python
from typing import Generic, TypeVar

T = TypeVar("T")

class PaginatedResponse(BaseModel, Generic[T]):
    items: list[T]
    total: int
    offset: int
    limit: int
```

Replace `LLMLogListResponse` (removed, superseded by `PaginatedResponse[LLMCallLogItem]`).

### 2. Pagination helper function

Add to a new file `backend/pagination.py`:

```python
def paginate(query, offset: int, limit: int) -> tuple[list, int]:
    total = query.count()
    items = query.offset(offset).limit(limit).all()
    return items, total
```

### 3. Per-endpoint changes

| # | Endpoint | Change |
|---|----------|--------|
| 1 | `GET /api/training/records` | Response changed from `list[TrainingRecordBrief]` + headers → `PaginatedResponse[TrainingRecordBrief]`. Remove `response.headers["X-Total-Count"]` and `X-Has-More`. Body construction changes from returning list to returning `PaginatedResponse`. |
| 2 | `GET /api/admin/llm-logs` | Params changed from `page`/`page_size` → `offset`/`limit`. **Fix in-memory pagination**: apply `offset()`/`limit()` on DB queries (both aggregated + raw queries) instead of `.all()` + slice. Use `PaginatedResponse[LLMCallLogItem]`. |
| 3 | `GET /api/admin/users` | Add `offset`/`limit` params. Return `PaginatedResponse[UserBrief]`. |
| 4 | `GET /api/cases` | Add `offset`/`limit` params. Return `PaginatedResponse[CaseBrief]`. |
| 5 | `GET /api/cases/manage/list` | Add `offset`/`limit` params. Return `PaginatedResponse[CaseManageItem]`. |
| 6 | `GET /api/stats/teacher-summary` | Add `offset`/`limit` params. Return `PaginatedResponse[dict]`. |
| 7 | `GET /api/stats/ranking` | Add `offset`/`limit` params. Return `PaginatedResponse[dict]`. |

## Frontend Changes

### 1. New Pagination component (`frontend/src/components/Pagination.jsx`)

Reusable component with:
- Previous / Next buttons
- Page info display: "第 X-Y 条，共 Z 条"
- Props: `total`, `offset`, `limit`, `onChange(offset)`

Extract from existing `MonitorTab.jsx:99-102` pagination logic.

### 2. Update existing consumers

| Page | Change |
|------|--------|
| `History.jsx` | `res.data` → `res.data.items`. Add `<Pagination>`. State: `offset`. |
| `DashboardHome.jsx` | `res.data` → `res.data.items` (if using records API). |
| `RecordsTab.jsx` | `res.data` → `res.data.items`. Add `<Pagination>`. State: `offset`. |
| `MonitorTab.jsx` | Params: `page`/`page_size` → `offset`/`limit`. Response: `res.data.items`. Replace inline pagination with `<Pagination>`. |
| `UsersTab.jsx` | Response: `res.data.items` + `res.data.total`. Add `<Pagination>`. |
| `CasesTab.jsx` | Add `<Pagination>` to `manage/list` display. |
| `CaseSelect.jsx` | `res.data` → `res.data.items`. |
| `Stats.jsx` | Add `<Pagination>` for teacher-summary and ranking tabs. |

### 3. Update API functions

Update `frontend/src/api.js` — all list-returning functions destructure as needed (axios already returns `res.data`):

| Function | Change |
|----------|--------|
| `getRecords(params)` | No signature change (already accepts params). Add `offset`/`limit` to consumer calls. |
| `getUsers()` | Add `params` param. |
| `getCases()` | Add `params` param. |
| `getManageCases()` | Add `params` param. |
| `getLLMLogs(params)` | No signature change. Callers switch `page`→`offset`, `page_size`→`limit`. |
| `getTeacherSummary()` | Add `params` param. |
| `getStudentRanking()` | Add `params` param. |

## Default / Max Values per Endpoint

All endpoints use the same defaults (enforced by pagination helper or FastAPI Query):

- Default `limit`: 50
- Max `limit`: 100
- Default `offset`: 0

---

## Bonus: Stats Endpoints SQL Rewrite

### Problem

All 4 stats endpoints load entire tables into Python memory and aggregate in application code. `teacher-summary` and `ranking` have catastrophic N+1 query patterns (one query per student). With 100+ students and thousands of records, they will timeout.

### Solution: Push aggregation to SQL

| Endpoint | Before | After |
|----------|--------|-------|
| `GET /api/stats/duration` | `.all()` all records, Python loop per record | `SELECT DATE(start_time), SUM(EXTRACT(EPOCH FROM end_time-start_time)/60) FROM training_records WHERE status='completed' GROUP BY DATE(start_time)` |
| `GET /api/stats/trends` | `.all()` all records + separate Score `.all()`, Python `setdefault` | Single query with LEFT JOIN scores: `SELECT DATE(tr.start_time), COUNT(*), SUM(EXTRACT(...)/60), AVG(s.total_score) FROM training_records tr LEFT JOIN scores s ON s.record_id=tr.id WHERE tr.status='completed' GROUP BY DATE(tr.start_time)` |
| `GET /api/stats/teacher-summary` | N+1: for each student `.all()` their records, Python duration calc | Single query: `SELECT u.id, u.display_name, u.student_id, COUNT(tr.id), COALESCE(SUM(EXTRACT(EPOCH FROM tr.end_time-tr.start_time)/60), 0) FROM users u LEFT JOIN training_records tr ON tr.user_id=u.id AND tr.status='completed' WHERE u.role='student' GROUP BY u.id ORDER BY u.id` + `offset/limit` pagination |
| `GET /api/stats/ranking` | Double N+1: per student records + per student scores batch + Python sort | Single query: `SELECT u.id, u.display_name, u.student_id, COUNT(tr.id), COALESCE(AVG(s.total_score), 0), COALESCE(SUM(EXTRACT(...)/60), 0) FROM users u LEFT JOIN training_records tr ON ... LEFT JOIN scores s ON ... WHERE u.role='student' AND tr.status='completed' GROUP BY u.id ORDER BY AVG(s.total_score) DESC` + `offset/limit` |

**Note**: `duration` and `trends` are per-user (student sees own, teacher sees all). Both keep `period` filter applied as `WHERE start_time >= :since` in SQL.

---

## Bonus: PostgreSQL Indexes

Add Alembic migration with these indexes:

| Table | Index | Columns | Rationale |
|-------|-------|---------|-----------|
| `training_records` | `ix_tr_start_time` | `start_time` | Date filters in stats + admin/stats today query |
| `training_records` | `ix_tr_case_id` | `case_id` | manage/list `.count()` GROUP BY |
| `notes` | `ix_notes_record_id` | `record_id` | Notes filtered by record_id |

---

## Bonus: manage/list N+1 Fix

`GET /api/cases/manage/list` currently does `.count()` per case. Replace with:

```python
# Single subquery for training counts
counts = dict(
    db.query(TrainingRecord.case_id, func.count(TrainingRecord.id))
    .filter(TrainingRecord.case_id.in_([c.id for c in cases]))
    .group_by(TrainingRecord.case_id)
    .all()
)
# Then attach to each CaseManageItem
```

---

## Bonus: admin/stats Unfiltered Count Fix

`GET /api/admin/stats` calls `TrainingRecord.count()` with no filter (total_records). Acceptable for now but should use `func.count()` with `status='completed'` and add `start_time` filter for `today_records` (already filtered but missing index — see above).

---

## Bonus: Export Streaming Fix

`GET /api/export/records` uses `yield_per(100)` + `joinedload` — incompatible. Change `joinedload` to `selectinload`.

---

## Bonus: Backup Endpoint

`POST /api/admin/backup` is SQLite-only (`DATABASE_URL` parsing assumes `sqlite:///`). Add a check: return 501 Not Implemented when running on PostgreSQL. Future: implement `pg_dump`-based backup.

---

## What Stays the Same

- Authentication / authorization logic unchanged
- Filtering params (date_from, status, student_name, etc.) unchanged on existing endpoints
- `GET /api/admin/stats` — returns single AdminStats object, not a list (only index + unfiltered count fix)
