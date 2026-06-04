import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ClipboardList, Loader2, RefreshCw, Trash2 } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { deleteRecord, getRecords } from "@/api/api-client";
import type { components } from "@/api/api-types.gen";
import Layout from "@/components/Layout";
import { useToast } from "@/components/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import PageHeader from "@/components/ui/PageHeader";
import Pagination from "@/components/ui/Pagination";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import useAuthStore from "@/stores/authStore";
import { cn } from "@/lib/utils";

type TrainingRecordBrief = components["schemas"]["TrainingRecordBrief"];

interface FilterParams {
  status: string;
  date_from: string;
  date_to: string;
}

const LIMIT = 50;

const tdClass = "px-4 py-3";

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
    queryKey: ["records", offset, filters],
    queryFn: () => getRecords(params).then((r) => r.data),
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
    <Layout>
      <PageHeader title="训练记录" subtitle={user?.role === "teacher" ? "查看所有学生的训练记录" : "查看你的历史训练记录和评分结果"} icon={ClipboardList} />

      <div className="bg-card border border-border rounded-xl p-6">
        <div className="bg-gray-50 border border-gray-200 rounded-[10px] px-4 py-3.5 mb-4">
          <div className="flex gap-3 flex-wrap items-start">
            <div className="flex-[1_1_140px] min-w-[120px]">
              <label className="block text-xs font-semibold text-muted-foreground mb-1 uppercase tracking-wider">状态</label>
              <select
                value={filters.status}
                onChange={(e) => handleFilterChange("status", e.target.value)}
                className="w-full h-9 border border-gray-200 rounded-md bg-white px-2.5 text-sm font-[inherit] text-gray-900 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/10"
              >
                <option value="">全部</option>
                <option value="in_progress">进行中</option>
                <option value="completed">已完成</option>
              </select>
            </div>
            <div className="flex-[1_1_140px] min-w-[120px]">
              <label className="block text-xs font-semibold text-muted-foreground mb-1 uppercase tracking-wider">开始日期(起)</label>
              <input
                type="date"
                value={filters.date_from}
                onChange={(e) => handleFilterChange("date_from", e.target.value)}
                className="w-full h-9 border border-gray-200 rounded-md bg-white px-2.5 text-sm font-[inherit] text-gray-900 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/10"
              />
            </div>
            <div className="flex-[1_1_140px] min-w-[120px]">
              <label className="block text-xs font-semibold text-muted-foreground mb-1 uppercase tracking-wider">开始日期(止)</label>
              <input
                type="date"
                value={filters.date_to}
                onChange={(e) => handleFilterChange("date_to", e.target.value)}
                className="w-full h-9 border border-gray-200 rounded-md bg-white px-2.5 text-sm font-[inherit] text-gray-900 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/10"
              />
            </div>
            <div className="flex-[1_1_140px] min-w-[120px] self-end">
              <button
                type="button"
                className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 border border-gray-200 rounded-lg text-xs font-medium cursor-pointer font-[inherit] transition-colors hover:border-blue-500 hover:text-blue-500"
                onClick={clearFilters}
              >
                清除过滤
              </button>
            </div>
          </div>
        </div>

        {isLoading ? (
          <div className="text-center py-16 px-6 text-muted-foreground">
            <Loader2 size={42} className="animate-spin" />
            <div>加载中...</div>
          </div>
        ) : isError ? (
          <div className="text-center py-16 px-6 text-muted-foreground">
            <div className="text-gray-400 flex items-center justify-center mb-2.5">
              <ClipboardList size={42} />
            </div>
            <div className="text-destructive mb-3">{(error as { response?: { data?: { detail?: string } } })?.response?.data?.detail || "加载记录失败"}</div>
            <button
              type="button"
              className="inline-flex items-center justify-center gap-1.5 px-[22px] py-[9px] border-0 rounded-lg text-sm font-medium cursor-pointer font-[inherit] transition-all duration-150 bg-primary text-primary-foreground hover:bg-blue-700"
              onClick={() => refetch()}
            >
              <RefreshCw size={16} /> 重试
            </button>
          </div>
        ) : records.length === 0 ? (
          <div className="text-center py-16 px-6 text-muted-foreground">
            <div className="text-gray-400 flex items-center justify-center mb-2.5">
              <ClipboardList size={42} />
            </div>
            <div>暂无训练记录</div>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  {user?.role === "teacher" && (
                    <TableHead className="sticky top-0 z-10 bg-muted text-left px-4 py-2.5 text-muted-foreground font-semibold text-xs uppercase tracking-wider">
                      学生
                    </TableHead>
                  )}
                  {user?.role === "teacher" && (
                    <TableHead className="sticky top-0 z-10 bg-muted text-left px-4 py-2.5 text-muted-foreground font-semibold text-xs uppercase tracking-wider">
                      学号
                    </TableHead>
                  )}
                  <TableHead className="sticky top-0 z-10 bg-muted text-left px-4 py-2.5 text-muted-foreground font-semibold text-xs uppercase tracking-wider">
                    病例
                  </TableHead>
                  <TableHead className="sticky top-0 z-10 bg-muted text-left px-4 py-2.5 text-muted-foreground font-semibold text-xs uppercase tracking-wider">
                    开始时间
                  </TableHead>
                  <TableHead className="sticky top-0 z-10 bg-muted text-left px-4 py-2.5 text-muted-foreground font-semibold text-xs uppercase tracking-wider">
                    时长
                  </TableHead>
                  <TableHead className="sticky top-0 z-10 bg-muted text-left px-4 py-2.5 text-muted-foreground font-semibold text-xs uppercase tracking-wider">
                    状态
                  </TableHead>
                  <TableHead className="sticky top-0 z-10 bg-muted text-left px-4 py-2.5 text-muted-foreground font-semibold text-xs uppercase tracking-wider">
                    得分
                  </TableHead>
                  <TableHead className="sticky top-0 z-10 bg-muted text-left px-4 py-2.5 text-muted-foreground font-semibold text-xs uppercase tracking-wider">
                    操作
                  </TableHead>
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
                      {user?.role === "teacher" && <TableCell className={tdClass}>{String(re.user_display_name ?? "")}</TableCell>}
                      {user?.role === "teacher" && <TableCell className={cn(tdClass, "text-muted-foreground")}>{String(re.user_student_id ?? "")}</TableCell>}
                      <TableCell className={tdClass}>{String(re.case_name ?? "")}</TableCell>
                      <TableCell className={cn(tdClass, "text-xs text-muted-foreground")}>
                        {new Date(re.start_time as string).toLocaleString("zh-CN")}
                      </TableCell>
                      <TableCell className={cn(tdClass, durMins != null ? "text-muted-foreground" : "text-gray-400")}>
                        {durMins != null ? `${durMins} 分钟` : "进行中"}
                      </TableCell>
                      <TableCell className={tdClass}>
                        <span
                          className={cn(
                            "inline-block px-2.5 py-0.5 rounded-xl text-xs font-semibold",
                            r.status === "completed" ? "bg-green-50 text-green-700" : "bg-blue-50 text-blue-600",
                          )}
                        >
                          {r.status === "completed" ? "已完成" : "进行中"}
                        </span>
                      </TableCell>
                      <TableCell className={tdClass}>
                        {r.score_total != null ? (
                          <span className="font-semibold text-primary">{r.score_total}分</span>
                        ) : r.scoring_status === "pending" || r.scoring_status === "processing" ? (
                          <span className="text-xs text-amber-500">评分中...</span>
                        ) : r.scoring_status === "failed" ? (
                          <span className="text-xs text-red-500" title={r.scoring_error ?? undefined}>
                            评分失败
                          </span>
                        ) : (
                          <span className="text-gray-400">-</span>
                        )}
                      </TableCell>
                      <TableCell className={tdClass}>
                        <span className="text-blue-500 cursor-pointer font-medium hover:underline" onClick={() => navigate(`/record/${r.id}`)}>
                          查看详情
                        </span>
                        {r.status === "in_progress" && user?.role !== "teacher" && (
                          <span className="text-blue-500 cursor-pointer font-medium hover:underline ml-3" onClick={() => navigate(`/training/${r.id}`)}>
                            继续训练
                          </span>
                        )}
                        <button
                          type="button"
                          className="inline-flex items-center justify-center gap-1.5 px-3 py-1 border-0 rounded-lg text-xs font-medium cursor-pointer font-[inherit] transition-all duration-150 bg-red-500 text-white hover:bg-red-600 ml-3"
                          onClick={() => handleDeleteRecord(r)}
                        >
                          <Trash2 size={14} />
                        </button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
        <Pagination total={total} offset={offset} limit={LIMIT} onChange={setOffset} />
      </div>
    </Layout>
  );
}
