import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ClipboardList, Loader2, RefreshCw, Trash2 } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { deleteRecord, getRecords } from "@/api/api-client";
import type { components } from "@/api/api-types.gen";
import { queryKeys } from "@/api/query-keys";
import { useToast } from "@/components/Toast";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import EmptyState from "@/components/ui/EmptyState";
import PageHeader from "@/components/ui/PageHeader";
import Pagination from "@/components/ui/Pagination";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import useAuthStore from "@/stores/authStore";

type TrainingRecordBrief = components["schemas"]["TrainingRecordBrief"];

interface FilterParams {
  status: string;
  date_from: string;
  date_to: string;
}

const LIMIT = 50;

export default function History() {
  const [offset, setOffset] = useState(0);
  const [filters, setFilters] = useState<FilterParams>({ status: "", date_from: "", date_to: "" });
  const navigate = useNavigate();
  const toast = useToast();
  const { confirm } = useConfirm();
  const user = useAuthStore((s) => s.user);
  const queryClient = useQueryClient();

  const params: Record<string, unknown> = { offset, limit: LIMIT };
  if (filters.status) params.status = filters.status;
  if (filters.date_from) params.date_from = filters.date_from;
  if (filters.date_to) params.date_to = filters.date_to;

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: queryKeys.training.records({ offset, ...filters }),
    queryFn: () => getRecords(params).then((r) => r.data),
    staleTime: 2 * 60_000,
  });

  const records = data?.items ?? [];
  const total = data?.total ?? 0;

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteRecord(id),
    onSuccess: () => {
      toast.success("训练记录已删除");
      queryClient.invalidateQueries({ queryKey: ["records"] });
    },
    onError: (err: unknown) => {
      const axiosErr = err as { response?: { data?: { detail?: string } } };
      toast.error(axiosErr.response?.data?.detail || "删除失败");
    },
  });

  const handleDeleteRecord = async (r: TrainingRecordBrief) => {
    const ok = await confirm({
      title: "删除记录",
      message: `确定删除「${r.case_name}」的训练记录吗？此操作不可撤销。`,
      confirmLabel: "确定删除",
      danger: true,
    });
    if (!ok) return;
    deleteMutation.mutate(r.id);
  };

  const clearFilters = () => {
    setFilters({ status: "", date_from: "", date_to: "" });
    setOffset(0);
  };

  const handleFilterChange = (key: keyof FilterParams, value: string) => {
    setFilters((f) => ({ ...f, [key]: value }));
    setOffset(0);
  };

  return (
    <>
      <PageHeader title="训练记录" subtitle={user?.role === "teacher" ? "查看所有学生的训练记录" : "查看你的历史训练记录和评分结果"} icon={ClipboardList} />

      <div className="space-y-4">
        <div className="rounded-xl border bg-card p-4 sm:p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:flex-wrap">
            <div className="flex-1 min-w-[140px]">
              <label className="block text-xs font-medium text-muted-foreground mb-1.5">状态</label>
              <select
                value={filters.status}
                onChange={(e) => handleFilterChange("status", e.target.value)}
                className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
              >
                <option value="">全部</option>
                <option value="in_progress">进行中</option>
                <option value="completed">已完成</option>
              </select>
            </div>
            <div className="flex-1 min-w-[140px]">
              <label className="block text-xs font-medium text-muted-foreground mb-1.5">开始日期(起)</label>
              <input
                type="date"
                value={filters.date_from}
                onChange={(e) => handleFilterChange("date_from", e.target.value)}
                className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
              />
            </div>
            <div className="flex-1 min-w-[140px]">
              <label className="block text-xs font-medium text-muted-foreground mb-1.5">开始日期(止)</label>
              <input
                type="date"
                value={filters.date_to}
                onChange={(e) => handleFilterChange("date_to", e.target.value)}
                className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
              />
            </div>
            <div className="flex gap-2 items-end">
              <Button variant="outline" size="default" onClick={clearFilters}>
                清除过滤
              </Button>
            </div>
          </div>
        </div>

        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <Loader2 size={36} className="animate-spin text-muted-foreground" />
            <span className="text-sm text-muted-foreground">加载中...</span>
          </div>
        ) : isError ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3 rounded-xl border bg-card">
            <ClipboardList size={40} className="text-muted-foreground/40" />
            <p className="text-sm text-destructive">{(error as { response?: { data?: { detail?: string } } })?.response?.data?.detail || "加载记录失败"}</p>
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              <RefreshCw size={14} />
              重试
            </Button>
          </div>
        ) : records.length === 0 ? (
          <div className="rounded-xl border bg-card">
            <EmptyState icon={ClipboardList} title="暂无训练记录" />
          </div>
        ) : (
          <div className="rounded-xl border bg-card overflow-hidden">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    {user?.role === "teacher" && (
                      <TableHead className="sticky top-0 z-10 bg-muted/50 font-semibold text-xs uppercase tracking-wider">学生</TableHead>
                    )}
                    {user?.role === "teacher" && (
                      <TableHead className="sticky top-0 z-10 bg-muted/50 font-semibold text-xs uppercase tracking-wider">学号</TableHead>
                    )}
                    <TableHead className="sticky top-0 z-10 bg-muted/50 font-semibold text-xs uppercase tracking-wider">病例</TableHead>
                    <TableHead className="sticky top-0 z-10 bg-muted/50 font-semibold text-xs uppercase tracking-wider">开始时间</TableHead>
                    <TableHead className="sticky top-0 z-10 bg-muted/50 font-semibold text-xs uppercase tracking-wider">时长</TableHead>
                    <TableHead className="sticky top-0 z-10 bg-muted/50 font-semibold text-xs uppercase tracking-wider">状态</TableHead>
                    <TableHead className="sticky top-0 z-10 bg-muted/50 font-semibold text-xs uppercase tracking-wider">得分</TableHead>
                    <TableHead className="sticky top-0 z-10 bg-muted/50 font-semibold text-xs uppercase tracking-wider">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {records.map((r) => {
                    const re = r as Record<string, unknown> & typeof r;
                    const durMins = re.end_time
                      ? Math.round((new Date(re.end_time as string).getTime() - new Date(re.start_time as string).getTime()) / 60000)
                      : null;
                    return (
                      <TableRow key={re.id as number}>
                        {user?.role === "teacher" && <TableCell>{String(re.user_display_name ?? "")}</TableCell>}
                        {user?.role === "teacher" && <TableCell className="text-muted-foreground">{String(re.user_student_id ?? "")}</TableCell>}
                        <TableCell className="font-medium">{String(re.case_name ?? "")}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{new Date(re.start_time as string).toLocaleString("zh-CN")}</TableCell>
                        <TableCell className={cn(durMins != null ? "text-muted-foreground" : "text-muted-foreground/50")}>
                          {durMins != null ? `${durMins} 分钟` : "进行中"}
                        </TableCell>
                        <TableCell>
                          <Badge variant={r.status === "completed" ? "success" : "info"}>{r.status === "completed" ? "已完成" : "进行中"}</Badge>
                        </TableCell>
                        <TableCell>
                          {r.score_total != null ? (
                            <span className="font-semibold text-primary">{r.score_total}分</span>
                          ) : r.scoring_status === "pending" || r.scoring_status === "processing" ? (
                            <Badge variant="warning">评分中...</Badge>
                          ) : r.scoring_status === "failed" ? (
                            <span className="text-xs text-destructive" title={r.scoring_error ?? undefined}>
                              评分失败
                            </span>
                          ) : (
                            <span className="text-muted-foreground/40">-</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Button variant="link" size="xs" onClick={() => navigate(`/record/${r.id}`)}>
                              查看详情
                            </Button>
                            {r.status === "in_progress" && user?.role !== "teacher" && (
                              <Button variant="link" size="xs" onClick={() => navigate(`/training/${r.id}`)}>
                                继续训练
                              </Button>
                            )}
                            <Button variant="ghost" size="icon-xs" onClick={() => handleDeleteRecord(r)} className="text-destructive hover:text-destructive">
                              <Trash2 size={14} />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </div>
        )}
        <div className="rounded-xl border bg-card px-4 py-3">
          <Pagination total={total} offset={offset} limit={LIMIT} onChange={setOffset} />
        </div>
      </div>
    </>
  );
}
