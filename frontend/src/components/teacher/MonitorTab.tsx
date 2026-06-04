import { useMutation, useQuery } from "@tanstack/react-query";
import { Activity, BarChart3, Download, Server, TrendingUp, Zap } from "lucide-react";
import { useState } from "react";
import { exportLLMLogs, getLLMLogs, getLLMStats } from "@/api/api-client";
import type { components } from "@/api/api-types.gen";
import Badge from "@/components/ui/Badge";
import EmptyState from "@/components/ui/EmptyState";
import Pagination from "@/components/ui/Pagination";
import { cn } from "@/lib/utils";

type Schemas = components["schemas"];
type LLMCallLogItem = Schemas["LLMCallLogItem"];

const PURPOSE_LABELS: Record<string, string> = {
  patient_chat: "患者对话",
  scoring: "评分",
  qa: "问答",
  case_generation: "病例生成",
  summary: "总结",
  other: "其他",
  "*": "通配",
};

function purposeLabel(item: LLMCallLogItem): string {
  if (item.is_aggregated && item.purpose === "patient_chat") {
    return `训练对话（${item.call_count}轮）`;
  }
  return PURPOSE_LABELS[item.purpose] || item.purpose;
}

interface LLMStats {
  today: { count: number; success_rate: number; avg_latency_ms: number; total_cost: number };
  week: { count: number; success_rate: number; avg_latency_ms: number };
  month?: { count: number; total_cost: number };
  by_provider: { provider: string; count: number; total_cost: number; error_count: number }[];
  by_purpose: { purpose: string; count: number; avg_latency_ms: number; error_count: number }[];
  daily: { date: string; count: number; fail_count: number; total_cost?: number }[];
}

export default function MonitorTab() {
  const [offset, setOffset] = useState(0);
  const LIMIT = 20;
  const [filters, setFilters] = useState({ purpose: "", status: "", date_from: "", date_to: "" });

  const { data: stats } = useQuery({
    queryKey: ["llmStats"],
    queryFn: () => getLLMStats().then((r) => r.data as LLMStats),
  });

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

  const exportMutation = useMutation({
    mutationFn: () => exportLLMLogs(filters.date_from || undefined, filters.date_to || undefined),
    onSuccess: (resp) => {
      const blob = new Blob([resp.data as BlobPart], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "llm_logs_export.csv";
      a.click();
      URL.revokeObjectURL(url);
    },
  });

  if (!stats) {
    return (
      <div className="rounded-xl border border-border bg-card shadow-sm p-10 text-center text-muted-foreground/70">
        <Activity size={36} className="mx-auto mb-3" />
        <div>正在加载监控数据...</div>
      </div>
    );
  }

  const statCards = [
    { label: "调用次数", value: String(stats.today.count), sub: `${stats.week.count} (7日) · ${stats.month?.count ?? 0} (本月)`, color: "blue" },
    {
      label: "成功率",
      value: `${stats.today.success_rate}%`,
      sub: `${stats.week.success_rate}% (7日)`,
      color: stats.today.success_rate >= 95 ? "green" : "amber",
    },
    { label: "平均延迟", value: `${stats.today.avg_latency_ms}ms`, sub: `${stats.week.avg_latency_ms}ms (7日)`, color: "blue" },
    { label: "预估费用", value: `¥${stats.today.total_cost.toFixed(4)}`, sub: `¥${(stats.month?.total_cost ?? 0).toFixed(2)} (本月)`, color: "amber" },
  ];

  return (
    <>
      <div className="mb-5">
        <h3 className="text-[0.95rem] font-semibold mb-3 text-muted-foreground">今日概览</h3>
        <div className="grid grid-cols-4 gap-3 max-[900px]:grid-cols-2">
          {statCards.map((s, i) => (
            <div key={i} className="rounded-xl border border-border bg-card shadow-sm p-5 text-center">
              <div className="text-muted-foreground text-xs mb-1.5">{s.label}</div>
              <div className={cn("text-[1.8rem] font-bold", s.color === "green" ? "text-green-600" : s.color === "amber" ? "text-amber-500" : "text-primary")}>
                {s.value}
              </div>
              <div className="text-[0.7rem] text-muted-foreground/70 mt-0.5">{s.sub}</div>
            </div>
          ))}
        </div>
      </div>

      {stats.by_provider?.length > 0 && (
        <div className="rounded-xl border border-border bg-card shadow-sm p-4 mb-5">
          <h3 className="text-sm font-semibold mb-3 text-muted-foreground flex items-center gap-1.5">
            <BarChart3 size={14} /> 按 Provider 统计 (7日)
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr>
                  <th className="sticky top-0 z-10 text-left px-4 py-2.5 bg-muted text-muted-foreground font-semibold text-xs uppercase tracking-wider border-b border-border">
                    Provider
                  </th>
                  <th className="sticky top-0 z-10 text-left px-4 py-2.5 bg-muted text-muted-foreground font-semibold text-xs uppercase tracking-wider border-b border-border">
                    次数
                  </th>
                  <th className="sticky top-0 z-10 text-left px-4 py-2.5 bg-muted text-muted-foreground font-semibold text-xs uppercase tracking-wider border-b border-border">
                    费用
                  </th>
                  <th className="sticky top-0 z-10 text-left px-4 py-2.5 bg-muted text-muted-foreground font-semibold text-xs uppercase tracking-wider border-b border-border">
                    错误
                  </th>
                </tr>
              </thead>
              <tbody>
                {stats.by_provider.map((p) => (
                  <tr key={p.provider}>
                    <td className="px-4 py-3 border-b border-border font-semibold">{p.provider}</td>
                    <td className="px-4 py-3 border-b border-border">{p.count}</td>
                    <td className="px-4 py-3 border-b border-border text-amber-500">¥{p.total_cost.toFixed(4)}</td>
                    <td className="px-4 py-3 border-b border-border">
                      <Badge variant={p.error_count > 0 ? "danger" : "success"}>{p.error_count}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {stats.daily.length > 0 && (
        <div className="rounded-xl border border-border bg-card shadow-sm p-5 mb-5">
          <h3 className="text-[0.95rem] font-semibold mb-4 text-muted-foreground flex items-center gap-1.5">
            <TrendingUp size={16} /> 近30天每日调用趋势
          </h3>
          <div className="flex items-end gap-1 h-[120px] pt-2">
            {stats.daily.map((d) => {
              const maxCount = Math.max(...stats.daily.map((x) => x.count), 1);
              const h = Math.max(4, (d.count / maxCount) * 100);
              const failRatio = d.count > 0 ? d.fail_count / d.count : 0;
              return (
                <div key={d.date} className="flex-1 flex flex-col items-center min-w-0" title={`${d.date}: ${d.count}次 · ¥${(d.total_cost ?? 0).toFixed(4)}`}>
                  <div className="text-[0.55rem] text-muted-foreground/70 mb-0.5">{d.count || ""}</div>
                  <div
                    className="w-full rounded-t-sm opacity-85 min-h-[2px]"
                    style={{
                      height: `${h}%`,
                      background: failRatio > 0.2 ? "var(--red-400)" : "var(--blue-400)",
                    }}
                  />
                  <div className="text-[0.55rem] text-muted-foreground/70 mt-1 -rotate-45 origin-top-left whitespace-nowrap">{d.date.slice(5)}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="grid grid-cols-[1fr_2fr] gap-4 mb-5 max-[1000px]:grid-cols-1">
        <div className="rounded-xl border border-border bg-card shadow-sm p-4">
          <h3 className="text-sm font-semibold mb-3 text-muted-foreground flex items-center gap-1.5">
            <Activity size={14} /> 按用途统计 (7日)
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr>
                  <th className="sticky top-0 z-10 text-left px-4 py-2.5 bg-muted text-muted-foreground font-semibold text-xs uppercase tracking-wider border-b border-border">
                    用途
                  </th>
                  <th className="sticky top-0 z-10 text-left px-4 py-2.5 bg-muted text-muted-foreground font-semibold text-xs uppercase tracking-wider border-b border-border">
                    次数
                  </th>
                  <th className="sticky top-0 z-10 text-left px-4 py-2.5 bg-muted text-muted-foreground font-semibold text-xs uppercase tracking-wider border-b border-border">
                    延迟
                  </th>
                  <th className="sticky top-0 z-10 text-left px-4 py-2.5 bg-muted text-muted-foreground font-semibold text-xs uppercase tracking-wider border-b border-border">
                    错误
                  </th>
                </tr>
              </thead>
              <tbody>
                {stats.by_purpose.map((p) => (
                  <tr key={p.purpose}>
                    <td className="px-4 py-3 border-b border-border">
                      <Badge variant="info">{PURPOSE_LABELS[p.purpose] || p.purpose}</Badge>
                    </td>
                    <td className="px-4 py-3 border-b border-border font-semibold">{p.count}</td>
                    <td className="px-4 py-3 border-b border-border text-muted-foreground">{p.avg_latency_ms}ms</td>
                    <td className="px-4 py-3 border-b border-border">
                      <Badge variant={p.error_count > 0 ? "danger" : "success"}>{p.error_count}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card shadow-sm p-4">
          <h3 className="text-sm font-semibold mb-3 text-muted-foreground flex items-center gap-1.5">
            <Server size={14} /> 最近训练调用日志
          </h3>
          <div className="flex gap-2 mb-3 flex-wrap justify-between">
            <div className="flex gap-2 flex-wrap">
              <select
                value={filters.purpose}
                onChange={(e) => {
                  setFilters((f) => ({ ...f, purpose: e.target.value }));
                  setOffset(0);
                }}
                className="text-xs py-1 px-2 border border-border rounded-md bg-card"
              >
                <option value="">全部用途</option>
                {Object.entries(PURPOSE_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
              <select
                value={filters.status}
                onChange={(e) => {
                  setFilters((f) => ({ ...f, status: e.target.value }));
                  setOffset(0);
                }}
                className="text-xs py-1 px-2 border border-border rounded-md bg-card"
              >
                <option value="">全部状态</option>
                <option value="success">成功</option>
                <option value="failed">失败</option>
                <option value="timeout">超时</option>
              </select>
            </div>
            <button
              onClick={() => exportMutation.mutate()}
              className="flex items-center gap-1 text-xs py-1 px-3 border border-border rounded-md bg-card text-gray-600 cursor-pointer hover:bg-muted"
            >
              <Download size={13} /> 导出CSV
            </button>
          </div>
          {isLoading ? (
            <div className="text-center py-6 text-muted-foreground/70">加载中...</div>
          ) : logs.length === 0 ? (
            <EmptyState icon={Zap} title="暂无日志记录" className="py-6" />
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr>
                      <th className="sticky top-0 z-10 text-left px-4 py-2.5 bg-muted text-muted-foreground font-semibold text-xs uppercase tracking-wider border-b border-border">
                        时间
                      </th>
                      <th className="sticky top-0 z-10 text-left px-4 py-2.5 bg-muted text-muted-foreground font-semibold text-xs uppercase tracking-wider border-b border-border">
                        用途
                      </th>
                      <th className="sticky top-0 z-10 text-left px-4 py-2.5 bg-muted text-muted-foreground font-semibold text-xs uppercase tracking-wider border-b border-border">
                        Provider
                      </th>
                      <th className="sticky top-0 z-10 text-left px-4 py-2.5 bg-muted text-muted-foreground font-semibold text-xs uppercase tracking-wider border-b border-border">
                        状态
                      </th>
                      <th className="sticky top-0 z-10 text-left px-4 py-2.5 bg-muted text-muted-foreground font-semibold text-xs uppercase tracking-wider border-b border-border">
                        延迟
                      </th>
                      <th className="sticky top-0 z-10 text-left px-4 py-2.5 bg-muted text-muted-foreground font-semibold text-xs uppercase tracking-wider border-b border-border">
                        Token
                      </th>
                      <th className="sticky top-0 z-10 text-left px-4 py-2.5 bg-muted text-muted-foreground font-semibold text-xs uppercase tracking-wider border-b border-border">
                        费用
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {logs.map((item) => (
                      <tr key={item.id}>
                        <td className="px-4 py-3 border-b border-border text-xs text-muted-foreground whitespace-nowrap">
                          {new Date(item.created_at).toLocaleString("zh-CN")}
                        </td>
                        <td className="px-4 py-3 border-b border-border">
                          <Badge variant="info">{purposeLabel(item)}</Badge>
                        </td>
                        <td className="px-4 py-3 border-b border-border text-xs text-muted-foreground/70">{item.provider_name || "-"}</td>
                        <td className="px-4 py-3 border-b border-border">
                          <Badge variant={item.status === "success" ? "success" : "danger"}>
                            {item.status}
                            {item.error_count > 0 ? ` (${item.error_count}错)` : ""}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 border-b border-border text-muted-foreground">
                          {item.latency_ms != null ? `${item.latency_ms}ms${item.is_aggregated ? " 均" : ""}` : "-"}
                        </td>
                        <td className="px-4 py-3 border-b border-border text-sm">
                          {item.total_tokens != null ? `${item.total_tokens}${item.token_estimated ? "~" : ""}` : "-"}
                        </td>
                        <td className="px-4 py-3 border-b border-border text-sm text-amber-500">
                          {item.estimated_cost != null ? `¥${Number(item.estimated_cost).toFixed(4)}` : "-"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pagination total={logTotal} offset={offset} limit={LIMIT} onChange={setOffset} />
            </>
          )}
        </div>
      </div>
    </>
  );
}
