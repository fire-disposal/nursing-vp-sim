import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ClipboardList, Download, Trash2 } from "lucide-react";
import EmptyState from "@/components/ui/EmptyState";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { deleteRecord, exportRecords, getManageCases, getRecords } from "@/api/api-client";
import type { components } from "@/api/api-types.gen";
import { useToast } from "@/components/Toast";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import Pagination from "@/components/ui/Pagination";
import { cn } from "@/lib/utils";

type Schemas = components["schemas"];
type TrainingRecordBrief = Schemas["TrainingRecordBrief"];
type CaseManageItem = Schemas["CaseManageItem"];

interface Filters {
  student_name: string;
  case_id: string;
  status: string;
  date_from: string;
  date_to: string;
}

const thClass = "sticky top-0 z-10 text-left px-4 py-2.5 bg-muted text-muted-foreground font-semibold text-xs uppercase tracking-wider border-b border-border";
const tdClass = "px-4 py-3 border-b border-border";

export default function RecordsTab() {
  const [filters, setFilters] = useState<Filters>({ student_name: "", case_id: "", status: "", date_from: "", date_to: "" });
  const [offset, setOffset] = useState(0);
  const LIMIT = 50;
  const navigate = useNavigate();
  const toast = useToast();
  const { confirm } = useConfirm();
  const queryClient = useQueryClient();

  const params: Record<string, unknown> = { offset, limit: LIMIT };
  if (filters.student_name) params.student_name = filters.student_name;
  if (filters.case_id) params.case_id = filters.case_id;
  if (filters.status) params.status = filters.status;
  if (filters.date_from) params.date_from = filters.date_from;
  if (filters.date_to) params.date_to = filters.date_to;

  const { data: recordsData, isLoading } = useQuery({
    queryKey: ["adminRecords", offset, filters],
    queryFn: () => getRecords(params).then((r) => r.data),
  });

  const { data: casesData } = useQuery({
    queryKey: ["manageCases"],
    queryFn: () => getManageCases().then((r) => r.data),
  });

  const records = recordsData?.items ?? [];
  const total = recordsData?.total ?? 0;
  const caseOptions = casesData?.items.map((c: CaseManageItem) => ({ id: c.id, name: c.name })) ?? [];

  const exportMutation = useMutation({
    mutationFn: () => exportRecords(),
    onSuccess: (resp) => {
      const url = URL.createObjectURL(new Blob([resp.data as BlobPart], { type: "text/csv" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `training_records_${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("导出成功");
    },
    onError: () => toast.error("导出失败"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteRecord(id),
    onSuccess: () => {
      toast.success("训练记录已删除");
      queryClient.invalidateQueries({ queryKey: ["adminRecords"] });
    },
    onError: (err: unknown) => {
      const e = err as { response?: { data?: { detail?: string } } };
      toast.error(e.response?.data?.detail || "删除失败");
    },
  });

  const handleDelete = async (r: TrainingRecordBrief) => {
    const ok = await confirm({
      title: "删除记录",
      message: `确定删除"${r.user_display_name}"对"${r.case_name}"的训练记录吗？此操作不可恢复。`,
      confirmLabel: "确定删除",
      danger: true,
    });
    if (!ok) return;
    deleteMutation.mutate(r.id);
  };

  const clearFilters = () => setFilters({ student_name: "", case_id: "", status: "", date_from: "", date_to: "" });

  const handleFilterChange = (key: keyof Filters, value: string) => {
    setFilters((f) => ({ ...f, [key]: value }));
    setOffset(0);
  };

  const filterInputClass =
    "w-full h-9 border border-border rounded-md bg-card px-2.5 text-sm text-foreground focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/10";

  const scoreColor = (s: number | null) => {
    if (s == null) return "text-muted-foreground/70";
    if (s >= 85) return "text-green-600";
    if (s >= 70) return "text-primary";
    if (s >= 60) return "text-amber-600";
    return "text-destructive";
  };

  return (
    <div className="rounded-xl border border-border bg-card shadow-sm p-6">
      <div className="rounded-xl border border-border bg-muted shadow-sm p-3.5 mb-4">
        <div className="flex gap-3 flex-wrap items-start">
          <div className="flex-1 min-w-[120px]">
            <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">学生姓名</label>
            <input
              placeholder="模糊搜索..."
              value={filters.student_name}
              onChange={(e) => handleFilterChange("student_name", e.target.value)}
              className={filterInputClass}
            />
          </div>
          <div className="flex-1 min-w-[120px]">
            <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">病例</label>
            <select value={filters.case_id} onChange={(e) => handleFilterChange("case_id", e.target.value)} className={filterInputClass}>
              <option value="">全部</option>
              {caseOptions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex-1 min-w-[120px]">
            <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">状态</label>
            <select value={filters.status} onChange={(e) => handleFilterChange("status", e.target.value)} className={filterInputClass}>
              <option value="">全部</option>
              <option value="in_progress">进行中</option>
              <option value="completed">已完成</option>
            </select>
          </div>
          <div className="flex-1 min-w-[120px]">
            <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">开始日期(起)</label>
            <input type="date" value={filters.date_from} onChange={(e) => handleFilterChange("date_from", e.target.value)} className={filterInputClass} />
          </div>
          <div className="flex-1 min-w-[120px]">
            <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">开始日期(止)</label>
            <input type="date" value={filters.date_to} onChange={(e) => handleFilterChange("date_to", e.target.value)} className={filterInputClass} />
          </div>
          <div className="flex-1 min-w-[120px] self-end">
            <Button variant="ghost" size="sm" onClick={clearFilters}>
              清除过滤
            </Button>
          </div>
        </div>
      </div>

      <div className="mb-4 flex items-center justify-between">
        <span className="text-sm text-muted-foreground">共 {total} 条记录</span>
        <Button onClick={() => exportMutation.mutate()} disabled={exportMutation.isPending}>
          <Download size={16} />
          导出CSV
        </Button>
      </div>

      {isLoading ? (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
          <ClipboardList size={42} className="text-muted-foreground/70 mb-2.5" />
          <div>加载中...</div>
        </div>
      ) : records.length === 0 ? (
        <EmptyState icon={ClipboardList} title="暂无训练记录" />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                <th className={thClass}>学生</th>
                <th className={thClass}>学号</th>
                <th className={thClass}>病例</th>
                <th className={thClass}>状态</th>
                <th className={thClass}>开始时间</th>
                <th className={thClass}>时长</th>
                <th className={thClass}>得分</th>
                <th className={thClass}>操作</th>
              </tr>
            </thead>
            <tbody>
              {records.map((r) => {
                const durMins = r.end_time ? Math.round((new Date(r.end_time).getTime() - new Date(r.start_time).getTime()) / 60000) : null;
                return (
                  <tr key={r.id} className="hover:bg-muted">
                    <td className={tdClass}>{r.user_display_name}</td>
                    <td className={cn(tdClass, "text-muted-foreground")}>{r.user_student_id}</td>
                    <td className={tdClass}>{r.case_name}</td>
                    <td className={tdClass}>
                      <Badge variant={r.status === "completed" ? "success" : "info"}>{r.status === "completed" ? "已完成" : "进行中"}</Badge>
                    </td>
                    <td className={cn(tdClass, "text-sm text-muted-foreground")}>{new Date(r.start_time).toLocaleString("zh-CN")}</td>
                    <td className={cn(tdClass, durMins != null ? "text-muted-foreground" : "text-muted-foreground/70")}>
                      {durMins != null ? `${durMins} 分钟` : "进行中"}
                    </td>
                    <td className={tdClass}>
                      {r.score_total != null ? (
                        <span className={cn("font-semibold", scoreColor(r.score_total))}>{r.score_total}分</span>
                      ) : (
                        <span className="text-muted-foreground/70">-</span>
                      )}
                    </td>
                    <td className={tdClass}>
                      <div className="flex gap-2 items-center">
                        <span className="text-primary cursor-pointer font-medium hover:underline" onClick={() => navigate(`/record/${r.id}`)}>
                          查看
                        </span>
                        <Button variant="destructive" size="sm" onClick={() => handleDelete(r)} title="删除">
                          <Trash2 size={14} />
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <Pagination total={total} offset={offset} limit={LIMIT} onChange={setOffset} />
    </div>
  );
}
