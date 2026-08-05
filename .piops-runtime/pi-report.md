# PiOps Repair Report — Scoreboard 排名页作业筛选器不生效

## Summary

Repaired a clear code defect in `frontend/src/pages/admin/ScoreboardPage.tsx`: the ranking `useQuery` (and its `queryKey`) omitted `assignment_id`, so selecting a specific 作业 (assignment) in the filter bar updated the URL parameter but never affected the `/api/scoreboard/ranking` request. The filter UI and the backend endpoint already supported the parameter; only the request wiring was missing. The change is minimal (2 lines) and matches the correct pattern already used by `StudentTrendDialog`.

## Evidence

- Operator investigation (trusted): ScoreboardPage.tsx ranking `useQuery` (~224-246 行) request and queryKey both omit `assignment_id`; backend `/api/scoreboard/ranking` already supports the parameter; `StudentTrendDialog` shows the correct passing pattern.
- Confirmed in this checkout:
  - `frontend/src/pages/admin/ScoreboardPage.tsx`: `assignmentId` is parsed from `searchParams` (line 211) and included in `scope` (line 217, used by the trend dialog), but the ranking `useQuery` (lines 224-248) passes only `case_id`, `class_id`, `assignment_status`, `include_free`, `search`, `sort_by`, `tier`, `offset`, `limit` — no `assignment_id`.
  - `frontend/src/components/admin/scoreboard/StudentTrendDialog.tsx`: passes `assignment_id: scope.assignment_id ?? null` in both queryKey and queryFn — the reference pattern.
  - `frontend/src/api/scoreboard.ts`: `ScoreboardRankingParams` includes `assignment_id?: string | null` and `getScoreboardRanking` forwards `params` to the GET request.
  - `frontend/src/api/query-keys.ts`: `queryKeys.scoreboard.ranking(params)` accepts arbitrary params.
  - Backend `backend/modules/scoreboard/router.py` (ranking endpoint, `assignment_id` query param) and `backend/modules/scoreboard/service.py` (`if scope.assignment_id is not None: conditions.append(TrainingRecord.assignment_id == scope.assignment_id)`) confirm server-side filtering is implemented.

## Root cause

Frontend wiring gap in `ScoreboardPage.tsx`: the assignment filter updates the URL (`updateParam("assignment_id", ...)`) and the parsed value flows into `scope`, but the ranking `useQuery` never included `scope.assignment_id` in the request params or queryKey. Result: the request always uses the unfiltered (default) scope and the query cache key does not change when the filter changes, so the ranking table ignores the 作业 filter entirely.

Version check: the checkout (`v2026.08.05-6-4-g9d568e47`) is 4 commits ahead of the reported production version (`v2026.08.05-6`), but the only commit touching `ScoreboardPage.tsx` (83d0d177) is an ancestor of `v2026.08.05-6`, and `git show v2026.08.05-6:frontend/src/pages/admin/ScoreboardPage.tsx` confirms the identical defect exists at the production tag. The repair is therefore valid for both the checkout and production code.

## Changes

- `frontend/src/pages/admin/ScoreboardPage.tsx`: added `assignment_id: scope.assignment_id` to both
  - the `queryKeys.scoreboard.ranking({...})` params (query cache key), and
  - the `getScoreboardRanking({...})` request params.
- `frontend/src/__tests__/admin/ScoreboardPage.test.tsx` (new): focused test verifying
  - the ranking request receives `assignment_id: "ASSIGN-1"` when `?assignment_id=ASSIGN-1` is in the URL,
  - the ranking request receives `assignment_id: null` when no assignment is selected,
  - the page still renders.

No other files changed. No `.github/`, `deploy/`, `.piops-runtime/`, environment files, lock files, or migrations modified.

## Validation

- `npx tsc --noEmit` (frontend): pass.
- `npx biome lint` on changed files: pass (no issues).
- `npx vitest run` (full frontend suite): 46 files, 330 tests passed, 1 skipped (pre-existing).
- New test file `ScoreboardPage.test.tsx`: 3/3 pass.
- `npx vite build`: success (only pre-existing chunk-size warning).

## Risks

- Low. The change only forwards an already-parsed, already-filtered value to the request and query key; the backend, API layer, and query-key builder all accept it.
- Query cache behavior change is intended: switching the 作业 filter now re-fetches with the correct scope and no longer serves stale unfiltered data.
- `assignment_id` values are opaque strings (assignment IDs); the request previously sent no such param and now sends it as `null` when unselected — the backend treats `None` the same as absent (`scope.assignment_id is not None` guard), so no behavior change for the default view.
- Production mismatch: the checkout is ahead of the reported production version, but the defect (and fix surface) is byte-identical at tag `v2026.08.05-6`; no additional backport consideration needed.

## Rollback

Revert the two-line change in `frontend/src/pages/admin/ScoreboardPage.tsx` (remove both `assignment_id: scope.assignment_id,` lines) and delete `frontend/src/__tests__/admin/ScoreboardPage.test.tsx`. No migration, env, or lock-file changes to reverse.
