# Multi-Tenant Streamlining: Fix Leaks + Remove Dead Complexity

**Date**: 2026-06-08  
**Status**: Design  
**Author**: Tech Lead

---

## Goal

Fix 3 multi-tenant security leaks, strip unused super-admin/school-switching complexity while keeping school table and `school_id` column for future revival.

## Changes

### Part A: Fix Security Leaks

| File:Line | Leak | Fix |
|-----------|------|-----|
| `cases.py:227` `get_case` | No school filter — any user accesses any case | Add `resolve_school_filter` check |
| `admin.py:106` `update_user` | No school ownership check | Add `User.school_id == current_user.school_id` |
| `admin.py:286` `delete_user` | Same | Same |
| `admin.py:370-371` stats | Global `TrainingRecord` counts | Filter by user's school |

### Part B: Strip Dead Complexity

| File | Remove | Reason |
|------|--------|--------|
| `frontend/src/stores/schoolStore.ts` | `selectedSchoolId`, `isSuperAdmin()`, `getEffectiveSchoolId()` | Single school, no switching |
| `frontend/src/components/Layout.tsx` | School selector dropdown | Dead UI |
| `frontend/src/api/axios-instance.ts` | `school_id` query param injection | Unnecessary |
| `backend/middleware/dependencies.py` `resolve_school_filter` | super_admin nullable logic | Always use user's `school_id` |
| `backend/main.py` `_seed_data` | Per-school role duplication loop | Single default school only |

### Keep Unchanged

- `schools` table
- `school_id` column on all models
- Basic `User.school_id` FK
- School CRUD endpoints (`admin_schools.py`)

---

## Success Criteria

1. `get_case` with wrong school → 404
2. `admin` updating user from other school → forbidden
3. Admin stats scoped to school
4. Frontend: no school selector visible
5. All existing tests pass
6. `ruff check` clean
