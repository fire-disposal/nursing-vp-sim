import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ClipboardList, Download, Trash2 } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { deleteRecord, exportRecords, getManageCases, getRecords } from "@/api/api-client";
import type { components } from "@/api/api-types.gen";
import { useToast } from "@/components/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import Pagination from "@/components/ui/Pagination";

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

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-6">
      <div className="rounded-[10px] border border-gray-200 bg-gray-50 p-3.5 mb-4">
        <div className="flex gap-3 flex-wrap items-start">
          <div className="flex-1 min-w-[120px]">
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">学生姓名</label>
            <input
              placeholder="模糊搜索..."
              value={filters.student_name}
              onChange={(e) => handleFilterChange("student_name", e.target.value)}
              className="w-full h-9 border border-gray-200 rounded-md bg-white px-2.5 text-sm font-[inherit] text-gray-900 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/10"
            />
          </div>
          <div className="flex-1 min-w-[120px]">
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">病例</label>
            <select
              value={filters.case_id}
              onChange={(e) => handleFilterChange("case_id", e.target.value)}
              className="w-full h-9 border border-gray-200 rounded-md bg-white px-2.5 text-sm font-[inherit] text-gray-900 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/10"
            >
              <option value="">全部</option>
              {caseOptions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex-1 min-w-[120px]">
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">状态</label>
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
          <div className="flex-1 min-w-[120px]">
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">开始日期(起)</label>
            <input
              type="date"
              value={filters.date_from}
              onChange={(e) => handleFilterChange("date_from", e.target.value)}
              className="w-full h-9 border border-gray-200 rounded-md bg-white px-2.5 text-sm font-[inherit] text-gray-900 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/10"
            />
          </div>
          <div className="flex-1 min-w-[120px]">
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">开始日期(止)</label>
            <input
              type="date"
              value={filters.date_to}
              onChange={(e) => handleFilterChange("date_to", e.target.value)}
              className="w-full h-9 border border-gray-200 rounded-md bg-white px-2.5 text-sm font-[inherit] text-gray-900 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/10"
            />
          </div>
          <div className="flex-1 min-w-[120px] self-end">
            <button
              className="inline-flex items-center justify-center gap-1.5 px-3 py-1 text-xs font-medium rounded-lg border border-transparent text-gray-600 hover:bg-gray-100 transition-colors"
              onClick={clearFilters}
            >
              清除过滤
            </button>
          </div>
        </div>
      </div>

      <div className="mb-4 flex items-center justify-between">
        <span className="text-sm text-gray-500">共 {total} 条记录</span>
        <button
          className="inline-flex items-center justify-center gap-1.5 px-6 py-2 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          onClick={() => exportMutation.mutate()}
          disabled={exportMutation.isPending}
        >
          <Download size={16} />
          导出CSV
        </button>
      </div>

      {isLoading ? (
        <div className="flex flex-col items-center justify-center py-16 text-gray-500">
          <div className="text-gray-400 mb-2.5">
            <ClipboardList size={42} />
          </div>
          <div>加载中...</div>
        </div>
      ) : records.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-gray-500">
          <div className="text-gray-400 mb-2.5">
            <ClipboardList size={42} />
          </div>
          <div>暂无训练记录</div>
        </div>
      ) : (
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              <th className="text-left px-4 py-2.5 bg-gray-50 text-gray-500 font-semibold text-xs uppercase tracking-wider border-b border-gray-200">学生</th>
              <th className="text-left px-4 py-2.5 bg-gray-50 text-gray-500 font-semibold text-xs uppercase tracking-wider border-b border-gray-200">学号</th>
              <th className="text-left px-4 py-2.5 bg-gray-50 text-gray-500 font-semibold text-xs uppercase tracking-wider border-b border-gray-200">病例</th>
              <th className="text-left px-4 py-2.5 bg-gray-50 text-gray-500 font-semibold text-xs uppercase tracking-wider border-b border-gray-200">状态</th>
              <th className="text-left px-4 py-2.5 bg-gray-50 text-gray-500 font-semibold text-xs uppercase tracking-wider border-b border-gray-200">
                开始时间
              </th>
              <th className="text-left px-4 py-2.5 bg-gray-50 text-gray-500 font-semibold text-xs uppercase tracking-wider border-b border-gray-200">时长</th>
              <th className="text-left px-4 py-2.5 bg-gray-50 text-gray-500 font-semibold text-xs uppercase tracking-wider border-b border-gray-200">得分</th>
              <th className="text-left px-4 py-2.5 bg-gray-50 text-gray-500 font-semibold text-xs uppercase tracking-wider border-b border-gray-200">操作</th>
            </tr>
          </thead>
          <tbody>
            {records.map((r) => {
              const durMins = r.end_time ? Math.round((new Date(r.end_time).getTime() - new Date(r.start_time).getTime()) / 60000) : null;
              return (
                <tr key={r.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 border-b border-gray-200">{r.user_display_name}</td>
                  <td className="px-4 py-3 border-b border-gray-200 text-gray-500">{r.user_student_id}</td>
                  <td className="px-4 py-3 border-b border-gray-200">{r.case_name}</td>
                  <td className="px-4 py-3 border-b border-gray-200">
                    <span
                      className={`inline-block px-2.5 py-0.5 rounded-xl text-xs font-semibold ${r.status === "completed" ? "bg-green-50 text-green-700" : "bg-blue-50 text-blue-600"}`}
                    >
                      {r.status === "completed" ? "已完成" : "进行中"}
                    </span>
                  </td>
                  <td className="px-4 py-3 border-b border-gray-200 text-sm text-gray-500">{new Date(r.start_time).toLocaleString("zh-CN")}</td>
                  <td className={`px-4 py-3 border-b border-gray-200 ${durMins != null ? "text-gray-500" : "text-gray-400"}`}>
                    {durMins != null ? `${durMins} 分钟` : "进行中"}
                  </td>
                  <td className="px-4 py-3 border-b border-gray-200">
                    {r.score_total != null ? (
                      <span
                        className={`font-semibold ${
                          r.score_total >= 85
                            ? "text-green-600"
                            : r.score_total >= 70
                              ? "text-blue-600"
                              : r.score_total >= 60
                                ? "text-amber-600"
                                : "text-red-600"
                        }`}
                      >
                        {r.score_total}分
                      </span>
                    ) : (
                      <span className="text-gray-400">-</span>
                    )}
                  </td>
                  <td className="px-4 py-3 border-b border-gray-200">
                    <div className="flex gap-2 items-center">
                      <span className="text-blue-500 cursor-pointer font-medium hover:underline" onClick={() => navigate(`/record/${r.id}`)}>
                        查看
                      </span>
                      <button
                        className="inline-flex items-center justify-center gap-1.5 px-3 py-1 text-xs font-medium rounded-lg bg-red-100 text-red-600 hover:bg-red-200 transition-colors"
                        onClick={() => handleDelete(r)}
                        title="删除"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <Pagination total={total} offset={offset} limit={LIMIT} onChange={setOffset} />
    </div>
  );
}
