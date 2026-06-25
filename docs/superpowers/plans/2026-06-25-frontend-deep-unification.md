# Frontend Deep Unification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Globally unify the frontend's repeated patterns — admin list pages, hand-rolled forms, API-error toasts, CSS class constants, and search debounce — into shared primitives and stack built-ins, without behavioral regressions.

**Architecture:** Build three new shared primitives on the *existing* stack (no new deps): a column-defined `<DataTable>` on top of `ui/table.tsx`, a `useAdminList` hook composing `useDebouncedSearch` + TanStack Query, and a `<FormMessageBanner>`. Migrate forms to the already-installed `react-hook-form` + `zod` via the existing (but barely used) `ui/form.tsx` wrapper. Apply mechanical SAFE consolidations (error-toast, button styles, debounce).

**Tech Stack:** React 19, TypeScript, TanStack Query v5, zustand v5 (`useShallow`), axios, base-ui dialogs, Tailwind v4, react-hook-form ^7.77, @hookform/resolvers ^5.4, zod ^4.4. **Do NOT add `@tanstack/react-table`** (decided: not needed).

**Branch:** `refactor/frontend-deep-unification`. **No tags, no pushes.** Orderly commits only.

---

## Execution & Parallelism Strategy

- **Subagents share one working tree + git index.** Therefore: subagents EDIT files only; they MUST NOT run `git`, MUST NOT commit. The orchestrator runs `tsc`/`biome` and commits centrally after each wave.
- **Partition by file/page, not by track.** Each task owns a disjoint set of files and applies *all* changes for those files (toast + DataTable + RHF + debounce + styles). This guarantees no two parallel agents touch the same file.
- **Each new schema** goes in its own `frontend/src/schemas/<name>.ts`. Do NOT edit `schemas/index.ts` (import schemas directly to avoid a shared-file conflict).
- **Only the Foundations task edits `lib/styles.ts`.** All other tasks only IMPORT from it.
- **Verification per wave:** from `frontend/`, run `npx biome check --write <files>` then `npx tsc --noEmit` (must be zero errors). Then commit.
- **Commit messages** use `<emoji> <type>: <desc>`. Write the message to a repo-root temp file and `git commit -F` (PowerShell 5.1 mangles emoji on `-m`).

### Waves (low → high risk)

- **Wave 0 (sequential):** Foundations (new files + `lib/styles` additions).
- **Wave 1 (parallel):** Mechanical SAFE — error-toast (Assignments/Practices/Roles/Schools/SystemNotifications), button dedup (UserForm/BatchImport), debounce (QARecordsTab, Cases). NOTE: these files are re-edited in later waves; do Wave 1 first and commit so later diffs are clean.
- **Wave 2 (parallel):** Low-risk DataTable migrations — SchoolsPage, QuestionnaireList, QARecordsTab.
- **Wave 3 (parallel):** Low-risk RHF forms — SecretModal, ConfigModal, SystemNotificationsPage, SchoolsPage (form part).
- **Wave 4 (parallel):** Medium — PracticesPage, AssignmentsPage (DataTable + RHF), CaseList (DataTable), GradesClassesPage (DataTable view, keep zustand), Profile (RHF), RolesPage (RHF create form).
- **Wave 5 (sequential, high-risk, isolated commits):** UserForm (grade→class cascade RHF) + UserList DataTable; CaseForm (partial base-section RHF); RubricEditor (evaluate — likely leave).

---

## Canonical Patterns (reference for all tasks)

### P1. Error toast
Replace `toast.error(getApiErrorMessage(e, "X"))` → `toast.apiError(e, "X")` (verified identical: same default fallback "操作失败", same 6000ms). Remove the now-unused `import { getApiErrorMessage } from "@/lib/error-utils";` IF no other use remains in the file. Do NOT convert error paths that feed inline state (`setRegMsg`, `setCaseMsg`, `setSaveMsg`, etc.) — leave those. Do NOT touch `usePromptMutations.ts` (array validation) or `useScoringNotifications.ts` (sonner rich API).

### P2. CSS constants
Replace local `const btnPrimary = "..."` / `btnSecondary` that are **byte-identical** to `lib/styles` with `import { btnPrimary, btnSecondary } from "@/lib/styles";`. Replace local `inputClass` only where byte-identical to a new `lib/styles` variant (see Foundations). Do NOT replace divergent `selectClass`/`inputClass` (different radius/height/bg) — leave them.

### P3. Debounce
Use `useDebouncedSearch(default, delayMs)` from `@/hooks/useDebouncedSearch`. It returns `{ searchInput, debouncedValue, handleSearchChange, setSearchInput }`. Bind input `value={searchInput} onChange={e => handleSearchChange(e.target.value)}`; use `debouncedValue` in the query key + params. Reset offset via `useEffect(() => setOffset(0), [debouncedValue, ...filters])`.

### P4. DataTable usage
```tsx
import DataTable, { type DataTableColumn } from "@/components/ui/data-table";

const COLUMNS: DataTableColumn<Row>[] = [
  { key: "name", header: "名称", cellClassName: "font-medium" },
  { key: "created_at", header: "创建时间",
    render: (r) => r.created_at ? new Date(r.created_at).toLocaleDateString("zh-CN") : "" },
  { key: "actions", header: "操作", render: (r) => (
      <div className="flex gap-1">
        <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); onEdit(r); }}><Edit3 size={14}/></Button>
        <Button variant="ghost" size="sm" className="text-destructive" onClick={(e) => { e.stopPropagation(); onDelete(r); }}><Trash2 size={14}/></Button>
      </div>) },
];

<DataTable
  columns={COLUMNS} rows={items} rowKey={(r) => r.id}
  loading={isLoading}
  emptyIcon={SomeIcon} emptyTitle="暂无数据" emptyDescription="..."
  onRowClick={(r) => navigate(`/.../${r.id}`)}  // optional
  total={total} offset={offset} limit={limit} onOffsetChange={setOffset}  // optional pagination
/>
```
**Rule:** if `onRowClick` is set, action buttons MUST call `e.stopPropagation()`.

### P5. useAdminList usage
```tsx
const {
  items, total, isLoading,
  searchInput, handleSearchChange,
  offset, limit, setOffset,
  filters, setFilter,
  showModal, editingItem, openCreate, openEdit, closeModal,
} = useAdminList<Row, Filters>({
  queryKey: (p) => queryKeys.admin.x.list(p),
  queryFn: (p) => getX({ search: p.search || undefined, offset: p.offset, limit: p.limit, ...rest }).then(r => r.data ?? r),
  limit: 20, staleTime: 2 * 60_000, initialFilters: {},
});
```
The hook owns offset-reset-on-search/filter internally. Search input + filter controls render in the page (outside DataTable).

### P6. RHF form pattern (canonical)
```tsx
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { xFormSchema, type XFormValues } from "@/schemas/x";

const form = useForm<XFormValues>({ resolver: zodResolver(xFormSchema), defaultValues: {...} });
useEffect(() => { if (open) form.reset({ ...fromRecordOrDefaults }); }, [open, record, form]);

const onSubmit = async (values: XFormValues) => {
  try { await api(values); success("..."); onSaved(); onClose(); }
  catch (e) { apiError(e, "保存失败"); }   // or form.setError("root", { message }) + <FormMessageBanner>
};

<Form {...form}>
  <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3">
    <FormField control={form.control} name="label" render={({ field }) => (
      <FormItem><FormLabel>标签</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
    )} />
    <div className="flex justify-end gap-2">
      <Button variant="outline" type="button" onClick={onClose}>取消</Button>
      <Button type="submit" disabled={form.formState.isSubmitting}>{form.formState.isSubmitting ? "保存中..." : "保存"}</Button>
    </div>
  </form>
</Form>
```
Use `z.coerce.number()` for numeric inputs. Use `form.formState.isSubmitting` instead of a `saving` useState. Reference impl: `pages/Login.tsx`.

### P7. FormMessageBanner usage
```tsx
import { FormMessageBanner } from "@/components/ui/form-message-banner";
<FormMessageBanner type="error" message={msg} />   // renders nothing when message is null
```

---

## Task 0 (Wave 0, SEQUENTIAL): Foundations

**Files:**
- Create: `frontend/src/components/ui/form-message-banner.tsx`
- Create: `frontend/src/components/ui/data-table.tsx`
- Create: `frontend/src/hooks/useAdminList.ts`
- Modify: `frontend/src/lib/styles.ts` (add `inputClass`, `inputClassMd`)

- [ ] **Step 1: `form-message-banner.tsx`**
```tsx
import { cn } from "@/lib/utils";

interface FormMessageBannerProps {
  type?: "success" | "error";
  message: string | null | undefined;
  className?: string;
}

export function FormMessageBanner({ type = "error", message, className }: FormMessageBannerProps) {
  if (!message) return null;
  return (
    <div
      role="alert"
      className={cn(
        "px-3.5 py-2.5 rounded-lg text-sm mb-4",
        type === "success" ? "bg-success text-success-foreground" : "bg-destructive/10 text-destructive",
        className,
      )}
    >
      {message}
    </div>
  );
}

export default FormMessageBanner;
```

- [ ] **Step 2: `data-table.tsx`** — VERIFY exact import shapes of `ui/table.tsx` (named: Table/TableHeader/TableBody/TableRow/TableHead/TableCell), `ui/empty-state` (default `EmptyState`), `ui/loading-skeleton` (default `LoadingSkeleton`, supports `variant="table"`), `ui/pagination` (default `Pagination`, props `total/offset/limit/onChange`) before finalizing. Implement:
```tsx
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import EmptyState from "@/components/ui/empty-state";
import LoadingSkeleton from "@/components/ui/loading-skeleton";
import Pagination from "@/components/ui/pagination";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

export interface DataTableColumn<T> {
  key: string;
  header: string;
  render?: (row: T, index: number) => ReactNode;
  headerClassName?: string;
  cellClassName?: string;
}

export interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  rows: T[];
  rowKey?: (row: T) => string | number;
  loading?: boolean;
  emptyIcon?: LucideIcon;
  emptyTitle?: string;
  emptyDescription?: string;
  onRowClick?: (row: T, index: number) => void;
  stickyHeader?: boolean;
  total?: number;
  offset?: number;
  limit?: number;
  onOffsetChange?: (offset: number) => void;
  className?: string;
}

export default function DataTable<T>({
  columns, rows, rowKey, loading,
  emptyIcon, emptyTitle = "暂无数据", emptyDescription,
  onRowClick, stickyHeader = true,
  total, offset, limit, onOffsetChange, className,
}: DataTableProps<T>) {
  const wrapper = cn("rounded-xl border border-border bg-card shadow-sm overflow-hidden", className);

  if (loading && rows.length === 0) {
    return <div className={wrapper}><LoadingSkeleton variant="table" /></div>;
  }
  if (!loading && rows.length === 0) {
    return <div className={wrapper}><EmptyState icon={emptyIcon} title={emptyTitle} description={emptyDescription} /></div>;
  }

  const getKey = rowKey ?? ((r: T, i: number) => (r as { id?: string | number }).id ?? i);
  const th = cn(
    "text-left px-4 py-2.5 bg-muted text-muted-foreground font-semibold text-xs uppercase tracking-wider border-b border-border",
    stickyHeader && "sticky top-0 z-10",
  );

  return (
    <div className={wrapper}>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              {columns.map((c) => (
                <TableHead key={c.key} className={cn(th, c.headerClassName)}>{c.header}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row, idx) => (
              <TableRow
                key={getKey(row, idx)}
                className={cn(onRowClick && "cursor-pointer hover:bg-muted")}
                onClick={onRowClick ? () => onRowClick(row, idx) : undefined}
              >
                {columns.map((c) => (
                  <TableCell key={c.key} className={cn("px-4 py-3 border-b border-border", c.cellClassName)}>
                    {c.render ? c.render(row, idx) : String((row as Record<string, unknown>)[c.key] ?? "")}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {total != null && offset != null && limit != null && onOffsetChange && total > 0 && (
        <div className="px-4 py-3 border-t border-border">
          <Pagination total={total} offset={offset} limit={limit} onChange={onOffsetChange} />
        </div>
      )}
    </div>
  );
}
```
NOTE: if `ui/table.tsx`'s `TableHead`/`TableCell` already inject padding/border classes, dedupe to avoid doubled styling — verify by reading the file.

- [ ] **Step 3: `useAdminList.ts`**
```tsx
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { useDebouncedSearch } from "@/hooks/useDebouncedSearch";

interface ListResult<T> { items: T[]; total: number; }

export interface UseAdminListOptions<T, F extends Record<string, unknown>> {
  queryKey: (p: { search: string; offset: number; limit: number } & F) => readonly unknown[];
  queryFn: (p: { search: string; offset: number; limit: number } & F) => Promise<ListResult<T>>;
  limit?: number;
  staleTime?: number;
  debounceMs?: number;
  initialFilters?: F;
}

export function useAdminList<T, F extends Record<string, unknown> = Record<string, never>>(
  opts: UseAdminListOptions<T, F>,
) {
  const { limit = 20, staleTime = 60_000, debounceMs = 200, initialFilters = {} as F } = opts;
  const { searchInput, debouncedValue, handleSearchChange } = useDebouncedSearch("", debounceMs);
  const [offset, setOffset] = useState(0);
  const [filters, setFilters] = useState<F>(initialFilters);
  const [showModal, setShowModal] = useState(false);
  const [editingItem, setEditingItem] = useState<T | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reset paging when query inputs change
  useEffect(() => { setOffset(0); }, [debouncedValue, filters]);

  const params = { search: debouncedValue, offset, limit, ...filters } as { search: string; offset: number; limit: number } & F;
  const query = useQuery({
    queryKey: opts.queryKey(params),
    queryFn: () => opts.queryFn(params),
    placeholderData: keepPreviousData,
    staleTime,
  });

  const setFilter = useCallback(<K extends keyof F>(key: K, value: F[K]) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  }, []);
  const openCreate = useCallback(() => { setEditingItem(null); setShowModal(true); }, []);
  const openEdit = useCallback((item: T) => { setEditingItem(item); setShowModal(true); }, []);
  const closeModal = useCallback(() => { setShowModal(false); setEditingItem(null); }, []);

  return {
    items: query.data?.items ?? [],
    total: query.data?.total ?? 0,
    isLoading: query.isLoading || query.isFetching,
    refetch: query.refetch,
    searchInput, debouncedValue, handleSearchChange,
    offset, limit, setOffset,
    filters, setFilter, setFilters,
    showModal, editingItem, openCreate, openEdit, closeModal,
  } as const;
}

export default useAdminList;
```

- [ ] **Step 4: `lib/styles.ts` add input variants** (after `selectClass`):
```ts
export const inputClass =
  "w-full px-2.5 py-1.5 border border-border rounded-md text-sm bg-card text-foreground focus-ring";

export const inputClassMd =
  "w-full px-3 py-2 border border-border rounded-md text-sm bg-card focus-ring";
```

- [ ] **Step 5: Verify** — `npx biome check --write` the 4 files; `npx tsc --noEmit` (zero errors).
- [ ] **Step 6: Commit** — `✨ feat: 新增 DataTable / useAdminList / FormMessageBanner 共享原语 + lib/styles 输入变体`

---

## Wave 1 (PARALLEL): Mechanical SAFE consolidations

### Task 1A: Error-toast unification
**Files (each independent):** `pages/admin/AssignmentsPage.tsx`, `pages/admin/PracticesPage.tsx`, `pages/admin/RolesPage.tsx`, `pages/admin/SchoolsPage.tsx`, `pages/admin/SystemNotificationsPage.tsx`
- [ ] Apply P1 to every `toast.error(getApiErrorMessage(e, "..."))` (13 sites). Remove now-unused `getApiErrorMessage` imports.
- [ ] Verify biome+tsc. Commit: `♻️ refactor: 统一管理页 API 错误提示为 toast.apiError`

### Task 1B: Button-style dedup
**Files:** `components/teacher/users/UserForm.tsx`, `components/teacher/users/BatchImport.tsx`
- [ ] Apply P2: remove local identical `btnPrimary`/`btnSecondary`, import from `@/lib/styles`.
- [ ] Commit (fold into 1A commit or separate `♻️ refactor: 复用 lib/styles 按钮样式常量`).

### Task 1C: Debounce unification
**Files:** `components/teacher/QARecordsTab.tsx` (200ms, 1:1 per P3); `components/teacher/CasesTab.tsx` + `components/teacher/cases/CaseList.tsx` (lift 300ms debounce to parent via P3).
- [ ] Apply P3. Verify. Commit: `♻️ refactor: 搜索防抖统一为 useDebouncedSearch`

> Wave-1 note: 1A and 1C both touch QARecordsTab? No — 1A is admin pages, 1C touches QARecordsTab/Cases. Disjoint. 1B touches users files. All three are disjoint → parallel-safe.

---

## Wave 2 (PARALLEL): Low-risk DataTable migrations

### Task 2A: SchoolsPage list → DataTable (+ useAdminList)
**File:** `pages/admin/SchoolsPage.tsx`. Apply P4 + P5. Remove raw `<table>`, the `useEffect` offset-reset, the loading/empty ternary, conditional pagination. Keep mutations + create Dialog. (Form RHF handled in Wave 3 Task 3D — coordinate: if both waves edit SchoolsPage, do them in the SAME task to avoid re-touch. **Decision:** merge SchoolsPage list+form into one task here = Task 2A also does the RHF form per P6/P7.)
- [ ] Verify. Commit: `♻️ refactor: SchoolsPage 改用 DataTable/useAdminList + RHF 表单`

### Task 2B: QuestionnaireList → DataTable
**File:** `components/teacher/questionnaires/QuestionnaireList.tsx`. Apply P4 (controlled component; keep props; replace raw table; 4 action buttons in an `actions` column).
- [ ] Verify. Commit: `♻️ refactor: QuestionnaireList 改用 DataTable`

### Task 2C: QARecordsTab → DataTable
**File:** `components/teacher/QARecordsTab.tsx` (already debounced in 1C). Apply P4; keep preview Dialog.
- [ ] Verify. Commit: `♻️ refactor: QARecordsTab 改用 DataTable`

---

## Wave 3 (PARALLEL): Low-risk RHF forms

### Task 3A: SecretModal → RHF
**Files:** `components/teacher/SecretModal.tsx`, create `schemas/secret.ts`. Apply P6/P7. `rawKey` required only on create (guard in onSubmit or refine). Never prefill key.
- [ ] Commit: `♻️ refactor: SecretModal 迁移 react-hook-form + zod`

### Task 3B: ConfigModal → RHF
**Files:** `components/teacher/ConfigModal.tsx`, create `schemas/llm-config.ts`. Keep async `fetchSecrets()` in `useEffect`; quick-create buttons stay outside RHF.
- [ ] Commit: `♻️ refactor: ConfigModal 迁移 react-hook-form`

### Task 3C: SystemNotificationsPage → RHF (+ already toast-unified)
**File:** `pages/admin/SystemNotificationsPage.tsx`, create `schemas/notification.ts`. datetime-local ↔ ISO conversion preserved.
- [ ] Commit: `♻️ refactor: SystemNotificationsPage 迁移 react-hook-form`

> Wave 3 disjoint from Wave 2 except SchoolsPage (handled in 2A) and SystemNotificationsPage (1A touched it for toast, but 1A is committed before Wave 3 — fine, sequential across waves).

---

## Wave 4 (PARALLEL): Medium-risk migrations

### Task 4A: PracticesPage (DataTable + RHF)
**File:** `pages/admin/PracticesPage.tsx`, create `schemas/practice.ts`. Uses `useApiQuery` → DataTable view; `features` Record<string,boolean> checkbox grid via Controller. Keep case-options fetch.
- [ ] Commit: `♻️ refactor: PracticesPage 改用 DataTable + RHF`

### Task 4B: AssignmentsPage (DataTable + RHF)
**File:** `pages/admin/AssignmentsPage.tsx`, create `schemas/assignment.ts`. Async practice/class lists; datetime-local; `statusBadge()` → column render; row-click(View)+edit/delete with stopPropagation.
- [ ] Commit: `♻️ refactor: AssignmentsPage 改用 DataTable + RHF`

### Task 4C: CaseList → DataTable
**Files:** `components/teacher/cases/CaseList.tsx` (debounce already lifted in 1C). Apply P4; delete button conditionally disabled when `training_count>0` (in render). AI button stays in the toolbar outside DataTable.
- [ ] Commit: `♻️ refactor: CaseList 改用 DataTable`

### Task 4D: GradesClassesPage (DataTable view only) + RHF form
**File:** `pages/admin/GradesClassesPage.tsx`. Keep zustand data source (do NOT migrate to useAdminList). Replace the two raw `<table>` with `<DataTable>` using existing `GRADE_COLUMNS`/`CLASS_COLUMNS` mapped to `DataTableColumn`. Migrate the 2-field dialog to RHF (`schemas/grade-class.ts`), replacing legacy `form-field.tsx` usage.
- [ ] Commit: `♻️ refactor: GradesClassesPage 表格用 DataTable + 表单 RHF`

### Task 4E: Profile → RHF
**File:** `pages/Profile.tsx`. Two `useForm` instances (profile + password). Use existing `schemas/auth.ts` `changePasswordSchema`. Gender button-toggle via Controller. Keep inline `FormMessageBanner` for server messages (per P1: inline state stays, but standardize the banner component).
- [ ] Commit: `♻️ refactor: Profile 迁移 react-hook-form`

### Task 4F: RolesPage → RHF (create dialog only)
**File:** `pages/admin/RolesPage.tsx`. Migrate the 2-field create dialog to RHF (`schemas/role.ts`). Keep the inline permission-checkbox editing as-is (not a classic form). Keep card list.
- [ ] Commit: `♻️ refactor: RolesPage 创建表单迁移 react-hook-form`

---

## Wave 5 (SEQUENTIAL, high-risk, isolated commits)

### Task 5A: Users — UserList DataTable + UserForm RHF cascade
**Files:** `components/teacher/users/UserList.tsx`, `components/teacher/users/UserForm.tsx`, `components/teacher/UsersTab.tsx`, create `schemas/user.ts`.
- [ ] UserList → DataTable (row-click → `/admin/users/:id`; edit/delete with stopPropagation).
- [ ] UserForm → RHF, dual mode (register/edit). Grade→class async cascade: `const grade = form.watch("grade")` + `useEffect` fetch classes + `form.setValue("class_id","")` with abort/stale guard. Preserve register-vs-edit field sets exactly.
- [ ] Verify carefully. Commit: `♻️ refactor: 用户管理列表 DataTable + 表单 RHF（含年级班级级联）`

### Task 5B: CaseForm partial RHF
**File:** `components/teacher/cases/CaseForm.tsx`, use existing `schemas/case.ts`. Migrate ONLY the "基础信息" section (name, difficulty, time_limit, description) to RHF; leave AI panel, JSON `scoring_criteria` textarea, plugin checkboxes, list fields as-is. Do NOT attempt a full rewrite.
- [ ] Verify. Commit: `♻️ refactor: CaseForm 基础信息段迁移 react-hook-form（其余维持）`

### Task 5C: RubricEditor — EVALUATE
**File:** `components/teacher/RubricEditor.tsx`. State is external (prop-driven `onChange`), 3-level nested arrays. RHF adds little here. **Decision: do NOT migrate to RHF.** Optionally add light zod validation on save in the parent. If no clear benefit, leave untouched and note in final summary.
- [ ] (Likely no commit.)

---

## Final verification

- [ ] From `frontend/`: `npx tsc --noEmit` (zero errors) and `npx biome check src/` (no errors; warnings ok).
- [ ] `git log --oneline` on branch shows ordered, coherent commits.
- [ ] Summarize per-task what changed and what was intentionally left (RubricEditor, divergent CSS, inline-state errors, MonitorTab) for branch review.

---

## Self-Review

- **Spec coverage:** Track A (DataTable+useAdminList) → Tasks 0,2A-C,4A-D,5A. Track B (RHF) → Tasks 0,2A,3A-C,4A-F,5A-B. Track C (mechanical) → Wave 1. All audit items mapped; MonitorTab/RubricEditor explicitly deferred with rationale.
- **Placeholder scan:** Foundation files have full code. Page tasks reference canonical patterns P1-P7 + instruct reading the target file (refactor of existing code, not greenfield) — acceptable since exact current code lives in the files.
- **Type consistency:** `DataTableColumn`/`DataTableProps`, `useAdminList` return shape, and RHF pattern names are consistent across tasks. `useAdminList.queryFn` returns `{items,total}`; callers unwrap Axios via `.then(r => r.data)`.
- **Parallel safety:** Each wave's tasks own disjoint files; cross-wave re-touch (SchoolsPage, SystemNotificationsPage) sequenced across waves. Only Task 0 edits `lib/styles.ts`; schemas are per-file (no shared barrel).

---

## Addendum — Reuse Primitives (foundation-2) + standing rules

After a reuse audit, these LOW-risk shared primitives were added (pure additions, zero consumers at creation):
- `lib/date.ts` — `formatDate` / `formatDateTime` / `toDatetimeLocal` / `fromDatetimeLocal`. Replace the 22+ inline `new Date().toLocale*("zh-CN")` sites and the bespoke datetime-local conversions during page/form migrations.
- `components/ui/role-badge.tsx` (`RoleBadge`) + `components/ui/difficulty-badge.tsx` (`DifficultyBadge`) — thin wrappers over `ui/badge`. Replace the duplicated role-color block (UserList/BatchImport) and the 3 difficulty definitions. Minor visual normalization to the design-system Badge is accepted/intended.
- `lib/useApiMutation.ts` (`useApiMutation`) — standardizes `invalidate + success toast / apiError`. Apply to the cleanest dedicated mutation hooks (useUserMutations, useQuestionnaireMutations) with the `onSuccess` escape hatch; leave complex ones (usePromptMutations array validation) as-is.

**Standing rules for ALL migration tasks (fold in, don't make separate tasks):**
- Forms adopt the existing `DialogFooter` + `FormMessageBanner` instead of bespoke footers/inline banners.
- Replace inline date formatting with `lib/date` helpers in any file you touch.
- Replace role/difficulty badges with `RoleBadge`/`DifficultyBadge` in any file you touch.
- Opportunistically replace byte-identical local `inputClass`/`selectClass`/button consts with `lib/styles` imports (skip divergent ones — visual risk).

**Deferred (decided NOT to force — weigh value vs risk):**
- Confirm-then-delete hook (destructive ops + varied guards; confirm dialog already shared).
- `useApiQuery` 37-site sweep (cosmetic unwrap, large churn, medium value).
- Generic `<Select>` + 45-site sweep (divergent styles, large churn).
- `StatusBadge` (too varied; only Role/Difficulty done).
- `useGradeClassCascade` is built/applied within Wave 5 (UserForm), not as a standalone foundation.
