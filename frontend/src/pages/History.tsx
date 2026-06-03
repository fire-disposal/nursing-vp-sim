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

      <div className="card">
        <div className="filter-bar">
          <div className="filter-row">
            <div className="filter-item">
              <label>状态</label>
              <select value={filters.status} onChange={(e) => handleFilterChange("status", e.target.value)}>
                <option value="">全部</option>
                <option value="in_progress">进行中</option>
                <option value="completed">已完成</option>
              </select>
            </div>
            <div className="filter-item">
              <label>开始日期(起)</label>
              <input type="date" value={filters.date_from} onChange={(e) => handleFilterChange("date_from", e.target.value)} />
            </div>
            <div className="filter-item">
              <label>开始日期(止)</label>
              <input type="date" value={filters.date_to} onChange={(e) => handleFilterChange("date_to", e.target.value)} />
            </div>
            <div className="filter-item" style={{ alignSelf: "flex-end" }}>
              <button type="button" className="btn btn-sm" onClick={clearFilters}>
                清除过滤
              </button>
            </div>
          </div>
        </div>

        {isLoading ? (
          <div className="empty-state">
            <Loader2 size={42} className="spin" />
            <div>加载中...</div>
          </div>
        ) : isError ? (
          <div className="empty-state">
            <div className="icon">
              <ClipboardList size={42} />
            </div>
            <div style={{ color: "var(--danger)", marginBottom: 12 }}>
              {(error as { response?: { data?: { detail?: string } } })?.response?.data?.detail || "加载记录失败"}
            </div>
            <button type="button" className="btn btn-primary" onClick={() => refetch()}>
              <RefreshCw size={16} /> 重试
            </button>
          </div>
        ) : records.length === 0 ? (
          <div className="empty-state">
            <div className="icon">
              <ClipboardList size={42} />
            </div>
            <div>暂无训练记录</div>
          </div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                {user?.role === "teacher" && <th>学生</th>}
                {user?.role === "teacher" && <th>学号</th>}
                <th>病例</th>
                <th>开始时间</th>
                <th>时长</th>
                <th>状态</th>
                <th>得分</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {records.map((r) => {
                const re = r as Record<string, unknown> & typeof r;
                const durMins = re.end_time
                  ? Math.round((new Date(re.end_time as string).getTime() - new Date(re.start_time as string).getTime()) / 60000)
                  : null;
                return (
                  <tr key={re.id as number}>
                    {user?.role === "teacher" && <td>{String(re.user_display_name ?? "")}</td>}
                    {user?.role === "teacher" && <td style={{ color: "var(--text-secondary)" }}>{String(re.user_student_id ?? "")}</td>}
                    <td>{String(re.case_name ?? "")}</td>
                    <td style={{ fontSize: "0.8rem", color: "var(--text-secondary)" }}>{new Date(re.start_time as string).toLocaleString("zh-CN")}</td>
                    <td style={{ color: durMins != null ? "var(--text-secondary)" : "var(--text-light)" }}>{durMins != null ? `${durMins} 分钟` : "进行中"}</td>
                    <td>
                      <span className={`badge ${r.status === "completed" ? "badge-success" : "badge-info"}`}>
                        {r.status === "completed" ? "已完成" : "进行中"}
                      </span>
                    </td>
                    <td>
                      {r.score_total != null ? (
                        <span style={{ fontWeight: 600, color: "var(--primary)" }}>{r.score_total}分</span>
                      ) : r.scoring_status === "pending" || r.scoring_status === "processing" ? (
                        <span style={{ fontSize: "0.78rem", color: "var(--amber-500)" }}>评分中...</span>
                      ) : r.scoring_status === "failed" ? (
                        <span style={{ fontSize: "0.78rem", color: "var(--red-500)" }} title={r.scoring_error ?? undefined}>
                          评分失败
                        </span>
                      ) : (
                        <span style={{ color: "var(--text-light)" }}>-</span>
                      )}
                    </td>
                    <td>
                      <span className="link" onClick={() => navigate(`/record/${r.id}`)}>
                        查看详情
                      </span>
                      {r.status === "in_progress" && user?.role !== "teacher" && (
                        <span className="link" style={{ marginLeft: 12 }} onClick={() => navigate(`/training/${r.id}`)}>
                          继续训练
                        </span>
                      )}
                      <button type="button" className="btn btn-sm btn-danger" style={{ marginLeft: 12 }} onClick={() => handleDeleteRecord(r)}>
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <Pagination total={total} offset={offset} limit={LIMIT} onChange={setOffset} />
      </div>
    </Layout>
  );
}
