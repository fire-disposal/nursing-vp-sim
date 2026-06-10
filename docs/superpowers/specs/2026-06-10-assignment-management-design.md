# Assignment Management — Teacher Batch Publish & Grade Export

**Date**: 2026-06-10
**Branch**: plugin
**Status**: 🔵 Design Approved

## Overview

Introduce an **Assignment** entity as a first-class abstraction between Case and TrainingRecord. Assignment carries plugin feature overrides, time-window constraints, class targeting, and enables batch grade export. This completes the teacher workflow: publish → student receive → complete → score → export.

## Motivation

Currently `Case → TrainingRecord` is a direct, unstructured relationship. Students freely pick cases; teachers have no mechanism to assign exercises to specific classes with deadlines, control which plugins are active, or batch-export grades. The plugin architecture refactoring makes this the right time to introduce an assignment layer that doubles as the plugin configuration carrier.

## Data Model

### New Table: `assignments`

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | UUID | PK, default uuid4 | |
| `case_id` | INTEGER | FK → cases.id, NOT NULL | The patient case |
| `class_id` | INTEGER | FK → classes.id, NOT NULL | Target class |
| `teacher_id` | INTEGER | FK → users.id, NOT NULL | Publishing teacher |
| `title` | VARCHAR(200) | NOT NULL | Exercise title (defaults to case name) |
| `description` | TEXT | NULLABLE | Supplementary instructions |
| `config_id` | VARCHAR(50) | NOT NULL, default "standard-assessment" | Session config preset |
| `feature_overrides` | JSONB | NOT NULL, default {} | Plugin toggle overrides, e.g. `{"physical_exam": true}` |
| `start_time` | TIMESTAMPTZ | NOT NULL | Visibility start |
| `end_time` | TIMESTAMPTZ | NOT NULL | Deadline (late submission allowed, flagged overdue) |
| `created_at` | TIMESTAMPTZ | NOT NULL, default now() | |
| `updated_at` | TIMESTAMPTZ | NOT NULL, default now() | |

### Modified Table: `training_records`

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `assignment_id` | UUID | FK → assignments.id, NULLABLE | Link to assignment; NULL for free-pick sessions |

### Feature Override Resolution Chain

When a student starts training from an assignment, the final `features` in `config_snapshot` resolve as:

```
session_config.default_features  (JSON file defaults)
  → merged with case.supported_plugins  (gates which plugins are available)
    → overridden by assignment.feature_overrides  (teacher's locked choices)
```

The resolved features are frozen into `training_record.config_snapshot.features` at session creation time and are **immutable** for assignment-originated sessions (frontend toggle controls are disabled).

## Backend

### Routes

All under `/api/assignments`. Teacher-only; school-scoped isolation.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/api/assignments` | `score_review` | Create assignment |
| `GET` | `/api/assignments` | `score_review` | List teacher's own assignments (paginated, filterable by class/status) |
| `GET` | `/api/assignments/{id}` | `score_review` | Assignment detail + completion stats per student |
| `PUT` | `/api/assignments/{id}` | `score_review` | Edit (only before start_time or in-progress) |
| `DELETE` | `/api/assignments/{id}` | `score_review` | Delete (only if no student has started) |
| `GET` | `/api/assignments/{id}/export` | `export_data` | Export class scores as Excel (.xlsx) |
| `GET` | `/api/students/assignments` | `training_access` | Student's pending/completed/overdue assignments |
| `POST` | `/api/assignments/{id}/start` | `training_access` | Start training from assignment → creates TrainingRecord |

### Session Integration

`POST /api/assignments/{id}/start`:

1. Load assignment, verify student belongs to assignment's class
2. Verify current time is within or after window (late submissions allowed, flagged)
3. Load case + session config
4. Merge features: config defaults → case.supported_plugins → assignment.feature_overrides
5. Create TrainingRecord with `assignment_id` and merged `config_snapshot`
6. Mark `config_snapshot["_from_assignment"] = true` for frontend lock detection
7. Return `{ record_id, greeting }`

### Export

`GET /api/assignments/{id}/export`:

- Query all training records for this assignment with their scores
- Generate Excel (.xlsx) with columns: 学号, 姓名, 各维度得分, 总分, 完成时间, 对话轮数
- Use `openpyxl` as the existing codebase already depends on it

### Scoring Queue

- `TaskQueue(max_workers=os.getenv("SCORING_WORKERS", 3))` — configurable via env
- `batch_evaluate()` — batch-submit multiple training records for scoring, reducing queue overhead
- Assignment detail endpoint returns `scoring_progress` (completed / total)

### Schemas (Pydantic)

New schemas in `backend/schemas.py`:

- `AssignmentCreateRequest` — case_id, class_id, config_id, feature_overrides, start_time, end_time, title?, description?
- `AssignmentUpdateRequest` — same fields, all optional
- `AssignmentResponse` — full assignment with computed fields (student_count, completed_count, overdue_count)
- `AssignmentListItem` — list view (title, case_name, class_name, time window, completion rate)
- `StudentAssignmentItem` — student view (id, title, case_name, deadline, status)

### Naming Clash

Existing `CaseAssignmentRequest` in schemas.py is for questionnaire-to-case linking. The new assignment entity uses distinct naming: `AssignmentCreateRequest`, `AssignmentResponse`, etc. No ambiguity.

## Frontend

### New Page: `/admin/assignments`

- **List view**: Table with columns (title, case, class, time window, completion rate, status badge). Actions: edit, delete, view details, export.
- **Create/Edit dialog** (modal or slide-over):
  - Case selector (combobox with search)
  - Class selector (grouped by grade)
  - Config preset selector (dropdown: standard-assessment / scenario-simulation / free-exploration / classroom-practice)
  - Plugin toggle panel (checkbox group for 5 feature flags, reflecting feature_overrides)
  - DateTime pickers for start_time and end_time
  - Title and description text inputs
- **Detail page**: Student completion table (name, student_id, status, score, time) + scoring progress bar + Export Excel button
- Permission: `score_review`
- Navigation: added to admin sidebar under existing items

### Modified: `DashboardHome.tsx`

- Add "待完成练习" (Pending Exercises) card section at top of Dashboard
- Only visible when `GET /api/students/assignments` returns items with status `pending`
- Each card shows: assignment title, case name, countdown to deadline, overdue badge if past end_time
- Click → `POST /api/assignments/{id}/start` → navigate to training

### Modified: `ChatTraining.tsx` / `TrainingHeader.tsx`

- Read `config_snapshot._from_assignment` from TrainingRecord
- If true, disable (gray out) all feature toggle switches in `TrainingHeader`
- Add tooltip: "此练习的插件配置由教师设定，不可更改"

### New: `api/assignments.ts`

Frontend API client following existing patterns (axios instance, query keys).

### Routing

Add in `App.tsx`:
```
/admin/assignments → AdminAssignments (lazy)
/admin/assignments/:id → AdminAssignmentDetail (lazy)
```

## Workflow

```
Teacher                          Student
──────                          ──────
Create Assignment                Dashboard shows pending card
  ├─ Select case                   │
  ├─ Select class                  │ Click "开始练习"
  ├─ Choose config + plugins       ▼
  ├─ Set time window              POST /assignments/{id}/start
  └─ Publish                       │
                                   ▼
start_time arrives                TrainingRecord created
  │                               features locked from assignment
  ▼                               
Student sees in Dashboard         ChatTraining (switches disabled)
  │                                 │
  │                                 ▼
  │                               Complete → scoring queue
  │                                 │
  │                                 ▼
end_time passes                   Score saved, can view in History
  │                               
  ▼                               
Teacher checks detail page        
  ├─ See completion rate          
  ├─ See per-student scores       
  └─ Export Excel                 
```

## Edge Cases

1. **Late submission**: Students can start after `end_time`; training is marked `overdue` in the response. No score penalty, just a badge.
2. **Multiple attempts**: A student can only have one TrainingRecord per assignment. Re-starting returns the existing record.
3. **Case edit after publish**: Assignment snapshots the case at start time via TrainingRecord; editing the case later does not affect active assignments. New starts use current case data.
4. **Class membership change**: If a student is removed from a class after assignment creation, they can still access their existing TrainingRecord but cannot start new ones.
5. **Teacher scope**: Teachers only see their own school's classes and students. Cross-school assignment is rejected at creation time.
6. **Empty class**: Creating an assignment for a class with 0 students is allowed (warning toast).
7. **feature_overrides outside supported_plugins**: Silently ignored at resolution time (case's supported_plugins is the ultimate gate).

## Implementation Estimate

| Phase | Work | Days |
|-------|------|------|
| Backend: Model + Migration | Add Assignment model, migration, TrainingRecord.assignment_id | 0.5 |
| Backend: Router + Schema | Assignment CRUD, student endpoints, Pydantic schemas | 2 |
| Backend: Session integration | start_training_from_assignment, feature merge, lock flag | 1 |
| Backend: Export | Excel export by assignment, batch scoring optimization | 1 |
| Frontend: Assignment pages | Admin list + create/edit + detail | 2 |
| Frontend: Dashboard + lock | Dashboard card, TrainingHeader lock | 1 |
| Testing | Backend + frontend tests | 1 |
| **Total** | | **8.5** |
