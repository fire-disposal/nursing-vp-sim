import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Bar, CartesianGrid, ComposedChart, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import EmptyState from "@/components/ui/EmptyState";
import { cn } from "@/lib/utils";
import { getTrends } from "../api/api-client";
import type { components } from "../api/api-types.gen";

type TrendStats = components["schemas"]["TrendStats"];

interface DayItem {
  date?: string;
  sessions?: number;
  minutes?: number;
  avg_score?: number | null;
}

interface ChartDataItem {
  name: string;
  sessions: number;
  minutes: number;
  avg_score: number | null;
}

const PERIODS = [
  { key: "week", label: "近7天" },
  { key: "month", label: "近30天" },
  { key: "all", label: "全部" },
];

export default function TrainingDurationChart() {
  const [period, setPeriod] = useState("month");

  const { data: trends, isLoading } = useQuery({
    queryKey: ["trends", period],
    queryFn: () => getTrends(period).then((r) => r.data),
    staleTime: 60_000,
  });

  const chartData = useMemo((): ChartDataItem[] => {
    const daily = (trends?.daily || []) as DayItem[];
    return daily.map((item) => ({
      name: item.date?.slice(5) || item.date || "",
      sessions: item.sessions || 0,
      minutes: item.minutes || 0,
      avg_score: item.avg_score ?? null,
    }));
  }, [trends]);

  const averageMinutes = trends?.total_sessions ? Math.round((trends.total_minutes || 0) / trends.total_sessions) : 0;

  return (
    <div className="bg-card border border-border rounded-xl p-6">
      <div className="flex items-start justify-between mb-3.5">
        <div>
          <h3 className="text-sm font-bold">训练投入趋势</h3>
          <span className="text-xs text-gray-400">每日训练次数与时长关联</span>
        </div>
        <div className="flex gap-0.5 bg-muted rounded-lg p-0.5">
          {PERIODS.map((p) => (
            <button
              key={p.key}
              className={cn(
                "py-[5px] px-3.5 border-none bg-transparent rounded-md text-xs font-medium text-muted-foreground cursor-pointer",
                period === p.key && "bg-card text-gray-800 font-semibold shadow-[0_1px_2px_rgba(0,0,0,0.04)]",
              )}
              onClick={() => setPeriod(p.key)}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-4 gap-2 mb-4 max-[768px]:grid-cols-2">
        <div className="text-center p-2 bg-muted rounded-lg">
          <span className="block text-sm font-bold">{trends?.total_sessions ?? 0}次</span>
          <span className="text-xs text-gray-400">训练次数</span>
        </div>
        <div className="text-center p-2 bg-muted rounded-lg">
          <span className="block text-sm font-bold">{trends?.total_minutes ?? 0}min</span>
          <span className="text-xs text-gray-400">总时长</span>
        </div>
        <div className="text-center p-2 bg-muted rounded-lg">
          <span className="block text-sm font-bold">{averageMinutes}min</span>
          <span className="text-xs text-gray-400">平均时长</span>
        </div>
        <div className="text-center p-2 bg-muted rounded-lg">
          <span className="block text-sm font-bold">{trends?.avg_score != null ? `${trends.avg_score}分` : "-"}</span>
          <span className="text-xs text-gray-400">平均得分</span>
        </div>
      </div>

      {isLoading ? (
        <div className="h-[200px] flex items-center justify-center border border-dashed border-border rounded-md bg-muted">
          <EmptyState title="正在加载训练统计..." />
        </div>
      ) : chartData.length > 0 ? (
        <ResponsiveContainer width="100%" height={220}>
          <ComposedChart data={chartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
            <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#9ca3af" }} axisLine={false} tickLine={false} />
            <YAxis yAxisId="left" tick={{ fontSize: 11, fill: "#9ca3af" }} axisLine={false} tickLine={false} />
            <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11, fill: "#9ca3af" }} axisLine={false} tickLine={false} unit="min" />
            <Tooltip
              contentStyle={{
                borderRadius: 8,
                border: "1px solid #e5e7eb",
                boxShadow: "0 4px 12px rgba(0,0,0,0.05)",
                fontSize: "0.8rem",
              }}
            />
            <Legend />
            <Bar yAxisId="left" dataKey="sessions" name="训练次数" fill="#2563eb" radius={[4, 4, 0, 0]} maxBarSize={28} />
            <Bar yAxisId="right" dataKey="minutes" name="训练时长" fill="#f59e0b" radius={[4, 4, 0, 0]} maxBarSize={28} />
          </ComposedChart>
        </ResponsiveContainer>
      ) : (
        <div className="h-[200px] flex items-center justify-center border border-dashed border-border rounded-md bg-muted">
          <EmptyState title="暂无训练统计数据" />
        </div>
      )}
    </div>
  );
}
