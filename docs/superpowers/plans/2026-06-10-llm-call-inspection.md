# LLM 调用链审查功能 - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 LLM 调用监控添加两层浏览模式 — 训练记录级时间线和单条调用详情展开（含完整 request/response 文本查看），翻新 MonitorTab 为实用化的调用审查工具。

**Architecture:** 复用现有 `LLMCallLog` 表和 `GET /admin/llm-logs/{log_id}` 端点。后端新增 `record_id` 过滤参数。前端新增两个组件（时间线 + 详情面板），重构 MonitorTab 支持从聚合表 drill-down 到单条内容。

**Tech Stack:** FastAPI + SQLAlchemy (backend), React + TypeScript + TailwindCSS + @tanstack/react-query (frontend)

---

### File Map

| Action | File | Purpose |
|--------|------|---------|
| Modify | `backend/routers/admin/export.py:130-141` | Add `record_id` query param to `/admin/llm-logs` |
| Modify | `frontend/src/api/admin/llm.ts` | Add `getLogDetail(id)` + `getRecordLogs(recordId)` |
| Create | `frontend/src/components/teacher/CallLogDetail.tsx` | Sheet 面板：展示单条调用的完整 prompt/response |
| Create | `frontend/src/components/teacher/CallLogTimeline.tsx` | 时间线组件：按时间排列某训练记录的所有 LLM 调用 |
| Modify | `frontend/src/components/teacher/MonitorTab.tsx` | 重构：聚合表点击行展开时间线，时间线点击条目打开详情 Sheet |

---

### Task 1: Backend — Add `record_id` filter to `/admin/llm-logs`

**Files:**
- Modify: `backend/routers/admin/export.py:130-141`

- [ ] **Step 1: Add `record_id` query parameter**

Edit `backend/routers/admin/export.py`, add the parameter to the function signature and apply filter in the raw query branch. The `aggregate_patient_chat=True` mode already groups by `record_id`, so the filter only makes sense when used with `aggregate_patient_chat=False`.

```python
# Change lines 130-148 of export.py:
@router.get("/llm-logs", response_model=PaginatedResponse[LLMCallLogItem])
def get_llm_logs(
    offset: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    purpose: str | None = None,
    status: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    record_id: int | None = None,          # NEW
    aggregate_patient_chat: bool = True,
    current_user: User = Depends(require_permission("llm_monitor")),
    db: Session = Depends(get_db),
):
    """
    Retrieve LLM call logs.
    When aggregate_patient_chat=True and purpose is patient_chat or absent,
    patient_chat calls are aggregated by record_id.
    Set aggregate_patient_chat=False and record_id=<id> to see individual calls
    for a specific training record.
    """
```

And add the filter in the `need_raw` branch (around line 197):

```python
    if need_raw:
        q = db.query(LLMCallLog)
        if record_id is not None:           # NEW
            q = q.filter(LLMCallLog.record_id == record_id)
        if aggregate_patient_chat and purpose is None:
            q = q.filter(LLMCallLog.purpose != "patient_chat")
        elif purpose:
            q = q.filter(LLMCallLog.purpose == purpose)
        if status:
            q = q.filter(LLMCallLog.status == status)
        if date_from:
            q = q.filter(LLMCallLog.created_at >= parse_iso_datetime(date_from))
        if date_to:
            q = q.filter(LLMCallLog.created_at < parse_iso_datetime(date_to))

        raw_count = q.order_by(None).count()
```

Also add the same filter in the aggregation branch (around line 175) so it respects `record_id` even in aggregated mode:

```python
        agg_q = agg_q.filter(
            LLMCallLog.purpose == "patient_chat",
            LLMCallLog.record_id.isnot(None),
        )
        if record_id is not None:           # NEW
            agg_q = agg_q.filter(LLMCallLog.record_id == record_id)
```

- [ ] **Step 2: Run existing tests**

```bash
cd /home/firedisposal/nursing-vp-sim/backend && uv run pytest tests/test_admin.py -k "llm_log" -v
```

Expected: All existing LLM log tests pass (new optional param should be backward compatible).

- [ ] **Step 3: Commit**

```bash
git add backend/routers/admin/export.py
git commit -m "feat: add record_id filter to /admin/llm-logs for call chain inspection"
```

---

### Task 2: Frontend API — Add new API functions

**Files:**
- Modify: `frontend/src/api/admin/llm.ts`

- [ ] **Step 1: Add `getLogDetail` and `getRecordLogs` functions**

Replace `frontend/src/api/admin/llm.ts`:

```typescript
import type { components } from "../api-types.gen";
import { api } from "../axios-instance";

type Schemas = components["schemas"];
type LLMCallLogItem = Schemas["LLMCallLogItem"];
type Paginated = Schemas["PaginatedResponse_LLMCallLogItem_"];

export const getLLMStats = () => api.get<Schemas["LLMStatsResponse"]>("/admin/llm-stats");

export const getLLMLogs = (params: Record<string, unknown> = {}) =>
  api.get<Paginated>("/admin/llm-logs", {
    params: { aggregate_patient_chat: true, ...params },
  });

export const getLogDetail = (logId: number) =>
  api.get<LLMCallLogItem>(`/admin/llm-logs/${logId}`);

export const getRecordLogs = (recordId: number) =>
  api.get<Paginated>("/admin/llm-logs", {
    params: {
      aggregate_patient_chat: false,
      record_id: recordId,
      limit: 100,
    },
  });

export const exportLLMLogs = (dateFrom?: string, dateTo?: string) => {
  const params: Record<string, string> = {};
  if (dateFrom) params.date_from = dateFrom;
  if (dateTo) params.date_to = dateTo;
  return api.get<Blob>("/admin/llm-logs/export", { params, responseType: "blob" });
};
```

- [ ] **Step 2: Verify the API barrel re-exports the new functions**

Check `frontend/src/api/admin/index.ts` already re-exports everything from `./llm`:

```bash
cd /home/firedisposal/nursing-vp-sim/frontend && grep -n "llm" src/api/admin/index.ts
```

If the file doesn't exist or line is missing, check `frontend/src/api/api-client.ts` which is the main barrel.

- [ ] **Step 3: Type-check**

```bash
cd /home/firedisposal/nursing-vp-sim/frontend && npx tsc --noEmit --strict src/api/admin/llm.ts 2>&1
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/api/admin/llm.ts
git commit -m "feat: add getLogDetail and getRecordLogs API functions"
```

---

### Task 3: Frontend — CallLogDetail Sheet component

**Files:**
- Create: `frontend/src/components/teacher/CallLogDetail.tsx`

- [ ] **Step 1: Create the component**

Create `frontend/src/components/teacher/CallLogDetail.tsx`:

```tsx
import { useQuery } from "@tanstack/react-query";
import { Clock, Cpu, DollarSign, FileText, Hash, Zap } from "lucide-react";
import { getLogDetail } from "@/api/api-client";
import type { components } from "@/api/api-types.gen";
import Badge from "@/components/ui/Badge";
import Sheet from "@/components/ui/Sheet";

type LLMCallLogItem = components["schemas"]["LLMCallLogItem"];

interface CallLogDetailProps {
  logId: number | null;
  onClose: () => void;
}

function Block({ label, content, maxH = "max-h-96" }: { label: string; content: string | null | undefined; maxH?: string }) {
  if (!content) return null;
  return (
    <div className="mb-4">
      <div className="text-xs font-semibold text-muted-foreground mb-1.5 uppercase tracking-wider">{label}</div>
      <pre className={cn("overflow-auto rounded-lg bg-muted/60 p-3 text-xs leading-relaxed whitespace-pre-wrap break-all", maxH)}>{content}</pre>
    </div>
  );
}

import { cn } from "@/lib/utils";

function MetaRow({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2 text-sm py-1.5 border-b border-border/50 last:border-0">
      <Icon size={14} className="text-muted-foreground shrink-0" />
      <span className="text-muted-foreground w-20 shrink-0">{label}</span>
      <span className="font-medium truncate">{value}</span>
    </div>
  );
}

export default function CallLogDetail({ logId, onClose }: CallLogDetailProps) {
  const { data: log, isLoading } = useQuery({
    queryKey: ["logDetail", logId],
    queryFn: () => getLogDetail(logId!).then((r) => r.data),
    enabled: logId !== null,
  });

  return (
    <Sheet open={logId !== null} onClose={onClose} side="right" size="lg">
      <div className="p-5 pt-14">
        {isLoading && <div className="text-center py-10 text-muted-foreground">加载中...</div>}
        {log && (
          <>
            <h2 className="text-lg font-bold mb-4 flex items-center gap-2">
              <FileText size={18} /> 调用详情 #{log.id}
            </h2>

            <div className="rounded-xl border border-border bg-card p-4 mb-4">
              <MetaRow icon={Clock} label="时间" value={new Date(log.created_at).toLocaleString("zh-CN")} />
              <MetaRow icon={Hash} label="用途" value={log.purpose} />
              <MetaRow icon={Cpu} label="模型" value={`${log.provider_name || "—"} / ${log.model || "—"}`} />
              <MetaRow icon={Zap} label="延迟" value={log.latency_ms != null ? `${log.latency_ms}ms` : "—"} />
              <MetaRow icon={Hash} label="Token" value={[
                log.prompt_tokens != null ? `P:${log.prompt_tokens}` : "",
                log.completion_tokens != null ? `C:${log.completion_tokens}` : "",
                log.total_tokens != null ? `T:${log.total_tokens}` : "",
                log.token_estimated ? "(估)" : ""
              ].filter(Boolean).join(" ") || "—"} />
              <MetaRow icon={DollarSign} label="费用" value={log.estimated_cost != null ? `¥${Number(log.estimated_cost).toFixed(6)} ${log.cost_currency || ""}`.trim() : "—"} />
              <MetaRow icon={Badge} label="状态" value="—" />
              <div className="flex items-center gap-2 text-sm py-2">
                <span className="text-muted-foreground w-20 shrink-0" />
                <Badge variant={log.status === "success" ? "success" : "danger"}>{log.status}</Badge>
                {log.error_type && <Badge variant="warning">{log.error_type}</Badge>}
              </div>
              {log.error_message && (
                <div className="mt-2 p-2 rounded bg-red-50 text-red-700 text-xs">{log.error_message}</div>
              )}
            </div>

            <Block label="System Prompt + Messages (请求)" content={log.request_text} />
            <Block label="LLM Response (响应)" content={log.response_text} />
          </>
        )}
      </div>
    </Sheet>
  );
}
```

- [ ] **Step 2: Type-check**

```bash
cd /home/firedisposal/nursing-vp-sim/frontend && npx tsc --noEmit src/components/teacher/CallLogDetail.tsx 2>&1
```

Fix any type errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/teacher/CallLogDetail.tsx
git commit -m "feat: add CallLogDetail sheet for viewing full request/response"
```

---

### Task 4: Frontend — CallLogTimeline component

**Files:**
- Create: `frontend/src/components/teacher/CallLogTimeline.tsx`

- [ ] **Step 1: Create the timeline component**

Create `frontend/src/components/teacher/CallLogTimeline.tsx`:

```tsx
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, ChevronRight, Clock, Hash, Zap, EyeIcon } from "lucide-react";
import { useState } from "react";
import { getRecordLogs } from "@/api/api-client";
import type { components } from "@/api/api-types.gen";
import Badge from "@/components/ui/Badge";
import CallLogDetail from "@/components/teacher/CallLogDetail";
import EmptyState from "@/components/ui/EmptyState";
import LoadingState from "@/components/ui/LoadingState";

type LLMCallLogItem = components["schemas"]["LLMCallLogItem"];

interface CallLogTimelineProps {
  recordId: number;
  onBack: () => void;
}

function statusColor(status: string): string {
  if (status === "success") return "bg-green-500";
  if (status === "timeout") return "bg-yellow-500";
  return "bg-red-500";
}

function costStr(cost: number | null | undefined): string {
  if (cost == null) return "—";
  return `¥${Number(cost).toFixed(4)}`;
}

export default function CallLogTimeline({ recordId, onBack }: CallLogTimelineProps) {
  const [selectedLogId, setSelectedLogId] = useState<number | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["recordLogs", recordId],
    queryFn: () => getRecordLogs(recordId).then((r) => r.data),
  });

  const logs: LLMCallLogItem[] = data?.items ?? [];

  const totals = logs.reduce(
    (acc, l) => ({
      calls: acc.calls + 1,
      tokens: acc.tokens + (l.total_tokens ?? 0),
      cost: acc.cost + (l.estimated_cost ?? 0),
    }),
    { calls: 0, tokens: 0, cost: 0 }
  );

  return (
    <div className="rounded-xl border border-border bg-card shadow-sm p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <button onClick={onBack} className="p-1 -ml-1 rounded hover:bg-muted transition-colors">
            <ArrowRight size={16} className="rotate-180 text-muted-foreground" />
          </button>
          <h3 className="text-sm font-semibold text-muted-foreground">
            训练记录 #{recordId} 调用时间线
          </h3>
        </div>
        <div className="flex gap-3 text-xs text-muted-foreground">
          <span>{totals.calls} 次调用</span>
          <span>{totals.tokens} token</span>
          <span>{costStr(totals.cost)}</span>
        </div>
      </div>

      {isLoading && <LoadingState message="加载时间线..." />}
      {!isLoading && logs.length === 0 && <EmptyState icon={Clock} title="暂无调用记录" className="py-8" />}
      {!isLoading && logs.length > 0 && (
        <div className="relative pl-6 before:absolute before:left-[7px] before:top-2 before:bottom-2 before:w-px before:bg-border">
          {logs.map((log, i) => (
            <div key={log.id} className="relative pb-3 last:pb-0">
              <div className={cn("absolute left-[-17px] top-1.5 size-[15px] rounded-full border-2 border-background", statusColor(log.status))} />

              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs text-muted-foreground font-mono">
                      {new Date(log.created_at).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                    </span>
                    <Badge variant="info" className="text-[0.65rem]">{log.purpose}</Badge>
                    <span className="text-[0.65rem] text-muted-foreground/70">{log.model || log.provider_name || "—"}</span>
                    <Badge variant={log.status === "success" ? "success" : log.status === "timeout" ? "warning" : "danger"} className="text-[0.65rem]">
                      {log.status}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground/70">
                    <span className="flex items-center gap-1"><Zap size={10} />{log.latency_ms != null ? `${log.latency_ms}ms` : "—"}</span>
                    <span className="flex items-center gap-1"><Hash size={10} />{log.total_tokens ?? "—"}{log.token_estimated ? "~" : ""}</span>
                    <span className="flex items-center gap-1">{costStr(log.estimated_cost)}</span>
                  </div>
                </div>
                <button
                  onClick={() => setSelectedLogId(log.id)}
                  className="shrink-0 flex items-center gap-0.5 text-xs text-primary hover:underline mt-1"
                >
                  <EyeIcon size={12} />
                  查看
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <CallLogDetail logId={selectedLogId} onClose={() => setSelectedLogId(null)} />
    </div>
  );
}
```

Fix: add the missing `cn` import at the top:

```tsx
import { cn } from "@/lib/utils";
```

- [ ] **Step 2: Type-check**

```bash
cd /home/firedisposal/nursing-vp-sim/frontend && npx tsc --noEmit src/components/teacher/CallLogTimeline.tsx 2>&1
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/teacher/CallLogTimeline.tsx
git commit -m "feat: add CallLogTimeline for per-record call chain view"
```

---

### Task 5: Frontend — Rework MonitorTab with drill-down

**Files:**
- Modify: `frontend/src/components/teacher/MonitorTab.tsx`

- [ ] **Step 1: Add state for selected record and import new components**

In `MonitorTab.tsx`, add imports and state:

Replace the import section (lines 1-9):

```tsx
import { useMutation, useQuery } from "@tanstack/react-query";
import { Activity, ArrowLeft, BarChart3, Download, Server, TrendingUp, Zap, Search } from "lucide-react";
import { useState } from "react";
import { exportLLMLogs, getLLMLogs, getLLMStats } from "@/api/api-client";
import type { components } from "@/api/api-types.gen";
import Badge from "@/components/ui/Badge";
import CallLogTimeline from "@/components/teacher/CallLogTimeline";
import EmptyState from "@/components/ui/EmptyState";
import Pagination from "@/components/ui/Pagination";
import { cn } from "@/lib/utils";
```

Add state and modify the log query section:

```tsx
export default function MonitorTab() {
  const [offset, setOffset] = useState(0);
  const LIMIT = 20;
  const [filters, setFilters] = useState({ purpose: "", status: "", date_from: "", date_to: "" });
  const [selectedRecordId, setSelectedRecordId] = useState<number | null>(null);

  // ... existing stats query unchanged ...

  const logParams: Record<string, unknown> = { offset, limit: LIMIT };
  if (filters.purpose) logParams.purpose = filters.purpose;
  if (filters.status) logParams.status = filters.status;
  if (filters.date_from) logParams.date_from = filters.date_from;
  if (filters.date_to) logParams.date_to = filters.date_to;

  const { data: logData, isLoading } = useQuery({
    queryKey: ["llmLogs", offset, filters],
    queryFn: () => getLLMLogs(logParams).then((r) => r.data),
  });
  const logs = logData?.items ?? [];
  const logTotal = logData?.total ?? 0;
```

- [ ] **Step 2: Add record_id link in the log table**

Modify the table body (around line 299-324) so each row is clickable when it has a `record_id`, and add a "record" column:

First, add the table header column after "时间":

```tsx
<th className="sticky top-0 z-10 text-left px-4 py-2.5 bg-muted text-muted-foreground font-semibold text-xs uppercase tracking-wider border-b border-border">
  记录
</th>
```

Then modify the row:

```tsx
{logs.map((item) => (
  <tr
    key={item.id}
    className={cn(
      item.record_id != null && "cursor-pointer hover:bg-muted/50 transition-colors"
    )}
    onClick={() => {
      if (item.record_id != null) setSelectedRecordId(item.record_id);
    }}
  >
    <td className="px-4 py-3 border-b border-border text-xs text-muted-foreground whitespace-nowrap">
      {new Date(item.created_at).toLocaleString("zh-CN")}
    </td>
    <td className="px-4 py-3 border-b border-border text-xs">
      {item.record_id != null ? (
        <span className="text-primary hover:underline font-mono">#{item.record_id}</span>
      ) : (
        <span className="text-muted-foreground/40">—</span>
      )}
    </td>
    <td className="px-4 py-3 border-b border-border">
      <Badge variant="info">{purposeLabel(item)}</Badge>
    </td>
    {/* ... rest of cells unchanged ... */}
  </tr>
))}
```

- [ ] **Step 3: Add timeline/back navigation below the log table**

After the `</Pagination>` line (line 328), add:

```tsx
{selectedRecordId != null && (
  <div className="mt-4">
    <CallLogTimeline
      recordId={selectedRecordId}
      onBack={() => setSelectedRecordId(null)}
    />
  </div>
)}
```

- [ ] **Step 4: Type-check the full component**

```bash
cd /home/firedisposal/nursing-vp-sim/frontend && npx tsc --noEmit src/components/teacher/MonitorTab.tsx 2>&1
```

- [ ] **Step 5: Check all three files together**

```bash
cd /home/firedisposal/nursing-vp-sim/frontend && npx tsc --noEmit 2>&1 | head -50
```

Fix any errors across all files.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/teacher/MonitorTab.tsx
git commit -m "feat: add record drill-down to LLM call log monitor"
```

---

### Task 6: Backend tests — Verify detail endpoint returns full text

**Files:**
- Check: `backend/tests/test_admin.py`

- [ ] **Step 1: Run backend tests for LLM log endpoints**

```bash
cd /home/firedisposal/nursing-vp-sim/backend && uv run pytest tests/test_admin.py -k "llm" -v
```

Expected: All LLM-related tests pass.

- [ ] **Step 2: Submit to CI (optional manual verification)**

If CI is set up, push to trigger it. Otherwise verify the full test suite:

```bash
cd /home/firedisposal/nursing-vp-sim/backend && uv run pytest -x -q 2>&1 | tail -20
```

- [ ] **Step 3: Final commit if any test fixes were needed**

```bash
git add backend/tests/test_admin.py
git commit -m "test: verify LLM log detail endpoint returns request/response text"
```
