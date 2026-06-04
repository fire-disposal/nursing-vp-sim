import { useQuery } from "@tanstack/react-query";
import { Activity, BarChart3, ClipboardList, Clock, Medal, Target, TrendingUp, Trophy } from "lucide-react";
import { useState } from "react";
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { getStudentRanking, getTeacherSummary, getTrends } from "@/api/api-client";
import type { components } from "@/api/api-types.gen";
import Layout from "@/components/Layout";
import { useToast } from "@/components/Toast";
import PageHeader from "@/components/ui/PageHeader";
import Pagination from "@/components/ui/Pagination";
import useAuthStore from "@/stores/authStore";
import type { User } from "@/types/store";
import { cn } from "@/lib/utils";

type TrendStats = components["schemas"]["TrendStats"];
type TeacherSummaryItem = components["schemas"]["TeacherSummaryItem"];
type RankingItem = components["schemas"]["RankingItem"];

interface DailyItem {
  date?: string;
  sessions?: number;
  minutes?: number;
  avg_score?: number | null;
}

interface ChartDataItem {
  date: string;
  sessions: number;
  minutes: number;
  avg_score: number | null;
}

interface StatsContentProps {
  period: string;
  setPeriod: (p: string) => void;
  trends: TrendStats | null | undefined;
  summary: TeacherSummaryItem[] | null;
  summaryOffset: number;
  setSummaryOffset: (n: number) => void;
  summaryTotal: number;
  ranking: RankingItem[] | null;
  rankingOffset: number;
  setRankingOffset: (n: number) => void;
  rankingTotal: number;
  user: User | null;
  LIMIT?: number;
}

export default function Stats() {
  const [period, setPeriod] = useState("month");
  const [summaryOffset, setSummaryOffset] = useState(0);
  const [rankingOffset, setRankingOffset] = useState(0);
  const _toast = useToast();
  const user = useAuthStore((s) => s.user);
  const LIMIT = 50;

  const { data: trends } = useQuery({
    queryKey: ["trends", period],
    queryFn: () => getTrends(period).then((r) => r.data),
  });

  const { data: summaryData } = useQuery({
    queryKey: ["teacherSummary", summaryOffset],
    queryFn: () => getTeacherSummary({ offset: summaryOffset, limit: LIMIT }).then((r) => r.data),
    enabled: user?.role === "teacher",
  });

  const { data: rankingData } = useQuery({
    queryKey: ["studentRanking", rankingOffset],
    queryFn: () => getStudentRanking({ offset: rankingOffset, limit: LIMIT }).then((r) => r.data),
    enabled: user?.role === "teacher",
  });

  const summary = summaryData?.items ?? null;
  const summaryTotal = summaryData?.total ?? 0;
  const ranking = rankingData?.items ?? null;
  const rankingTotal = rankingData?.total ?? 0;

  return (
    <StatsContent
      period={period}
      setPeriod={setPeriod}
      trends={trends}
      summary={summary}
      summaryOffset={summaryOffset}
      setSummaryOffset={setSummaryOffset}
      summaryTotal={summaryTotal}
      ranking={ranking}
      rankingOffset={rankingOffset}
      setRankingOffset={setRankingOffset}
      rankingTotal={rankingTotal}
      user={user}
    />
  );
}

export function StatsPage() {
  return (
    <Layout>
      <Stats />
    </Layout>
  );
}

const statIconBlue = "w-11 h-11 rounded-[10px] flex items-center justify-center shrink-0 bg-blue-50 text-blue-500";
const statIconAmber = "w-11 h-11 rounded-[10px] flex items-center justify-center shrink-0 bg-amber-50 text-amber-500";
const statIconGreen = "w-11 h-11 rounded-[10px] flex items-center justify-center shrink-0 bg-green-50 text-green-500";
const statIconCyan = "w-11 h-11 rounded-[10px] flex items-center justify-center shrink-0 bg-cyan-50 text-cyan-500";

const thClass = "text-left px-4 py-2.5 bg-gray-50 text-muted-foreground font-semibold text-xs uppercase tracking-wider border-b border-gray-200";
const tdClass = "px-4 py-3 border-b border-gray-200";

function StatsContent({
  period,
  setPeriod,
  trends,
  summary,
  summaryOffset,
  setSummaryOffset,
  summaryTotal,
  ranking,
  rankingOffset,
  setRankingOffset,
  rankingTotal,
  user,
  LIMIT = 50,
}: StatsContentProps) {
  const daily: ChartDataItem[] = (trends?.daily || []).map((item: unknown) => {
    const d = item as DailyItem;
    return {
      date: d.date || "",
      sessions: d.sessions || 0,
      minutes: d.minutes || 0,
      avg_score: d.avg_score ?? null,
    };
  });
  const hasData = daily.length > 0;

  return (
    <>
      <PageHeader
        title="训练统计"
        subtitle={user?.role === "teacher" ? "查看所有学生的训练趋势、时长和得分统计" : "查看你的训练投入与效果趋势"}
        icon={BarChart3}
      />

      {trends && (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-3.5 mb-6">
          <div className="bg-card border border-border rounded-xl py-4 px-6 flex items-center gap-3.5">
            <div className={statIconBlue}>
              <Activity size={22} />
            </div>
            <div>
              <div className="text-2xl font-bold leading-tight">{trends.total_sessions}</div>
              <div className="text-xs text-muted-foreground">总训练次数</div>
            </div>
          </div>
          <div className="bg-card border border-border rounded-xl py-4 px-6 flex items-center gap-3.5">
            <div className={statIconAmber}>
              <Clock size={22} />
            </div>
            <div>
              <div className="text-2xl font-bold leading-tight">{trends.total_minutes}</div>
              <div className="text-xs text-muted-foreground">总训练时长（分钟）</div>
            </div>
          </div>
          <div className="bg-card border border-border rounded-xl py-4 px-6 flex items-center gap-3.5">
            <div className={statIconGreen}>
              <Target size={22} />
            </div>
            <div>
              <div className="text-2xl font-bold leading-tight">{trends.avg_score != null ? `${trends.avg_score}分` : "-"}</div>
              <div className="text-xs text-muted-foreground">平均得分</div>
            </div>
          </div>
          <div className="bg-card border border-border rounded-xl py-4 px-6 flex items-center gap-3.5">
            <div className={statIconCyan}>
              <TrendingUp size={22} />
            </div>
            <div>
              <div className="text-2xl font-bold leading-tight">
                {trends.total_sessions > 0 ? `${Math.round(trends.total_minutes / trends.total_sessions)}分钟` : "-"}
              </div>
              <div className="text-xs text-muted-foreground">平均每次训练时长</div>
            </div>
          </div>
        </div>
      )}

      <div className="flex justify-end mb-4">
        <div className="flex gap-0.5 bg-gray-100 rounded-lg p-0.5">
          {["week", "month", "all"].map((p) => (
            <button
              key={p}
              className={cn(
                "px-3.5 py-1 border-0 bg-transparent rounded-md text-xs font-medium cursor-pointer font-[inherit]",
                period === p ? "bg-white text-gray-800 font-semibold shadow-sm" : "text-muted-foreground",
              )}
              onClick={() => setPeriod(p)}
            >
              {p === "week" ? "近7天" : p === "month" ? "近30天" : "全部"}
            </button>
          ))}
        </div>
      </div>

      <div className="bg-card border border-border rounded-xl p-6 mb-6">
        <h3 className="text-sm font-semibold mb-4">训练投入：次数与时长</h3>
        {hasData ? (
          <ResponsiveContainer width="100%" height={280}>
            <ComposedChart data={daily} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="date" tick={{ fontSize: 12 }} tickFormatter={(v: string) => v.slice(5)} />
              <YAxis
                yAxisId="left"
                tick={{ fontSize: 12 }}
                label={{
                  value: "次数",
                  position: "insideLeft",
                  offset: -5,
                  style: { fontSize: 12 },
                }}
              />
              <YAxis
                yAxisId="right"
                orientation="right"
                tick={{ fontSize: 12 }}
                label={{
                  value: "分钟",
                  position: "insideRight",
                  offset: -5,
                  style: { fontSize: 12 },
                }}
              />
              <Tooltip content={<CustomTooltip />} />
              <Legend />
              <Bar yAxisId="left" dataKey="sessions" name="训练次数" fill="#2563eb" radius={[4, 4, 0, 0]} barSize={28} />
              <Bar yAxisId="right" dataKey="minutes" name="训练时长" fill="#f59e0b" radius={[4, 4, 0, 0]} barSize={28} />
            </ComposedChart>
          </ResponsiveContainer>
        ) : (
          <EmptyChart />
        )}
      </div>

      <div className="bg-card border border-border rounded-xl p-6 mb-6">
        <h3 className="text-sm font-semibold mb-4">训练效果：次数与得分</h3>
        {hasData ? (
          <ResponsiveContainer width="100%" height={280}>
            <ComposedChart data={daily} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="date" tick={{ fontSize: 12 }} tickFormatter={(v: string) => v.slice(5)} />
              <YAxis
                yAxisId="left"
                tick={{ fontSize: 12 }}
                label={{
                  value: "次数",
                  position: "insideLeft",
                  offset: -5,
                  style: { fontSize: 12 },
                }}
              />
              <YAxis
                yAxisId="right"
                orientation="right"
                domain={[0, 60]}
                tick={{ fontSize: 12 }}
                label={{
                  value: "得分",
                  position: "insideRight",
                  offset: -5,
                  style: { fontSize: 12 },
                }}
              />
              <Tooltip content={<CustomTooltip />} />
              <Legend />
              <Bar yAxisId="left" dataKey="sessions" name="训练次数" fill="#2563eb" radius={[4, 4, 0, 0]} barSize={28} />
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="avg_score"
                name="平均得分"
                stroke="#22c55e"
                strokeWidth={2.5}
                dot={{ r: 4, fill: "#22c55e" }}
                connectNulls
              />
            </ComposedChart>
          </ResponsiveContainer>
        ) : (
          <EmptyChart />
        )}
      </div>

      {user?.role === "teacher" && summary && summary.length > 0 && (
        <div className="bg-card border border-border rounded-xl p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <ClipboardList size={18} />
              学生训练统计
            </h3>
          </div>
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                <th className={thClass}>学生</th>
                <th className={thClass}>学号</th>
                <th className={thClass}>训练次数</th>
                <th className={thClass}>总时长（分钟）</th>
                <th className={thClass}>平均时长</th>
              </tr>
            </thead>
            <tbody>
              {summary.map((s) => (
                <tr key={s.user_id} className="hover:bg-gray-50">
                  <td className={tdClass}>{s.display_name}</td>
                  <td className={cn(tdClass, "text-muted-foreground")}>{s.student_code}</td>
                  <td className={tdClass}>{s.total_sessions}</td>
                  <td className={cn(tdClass, "font-semibold")}>{s.total_minutes}</td>
                  <td className={cn(tdClass, "text-muted-foreground")}>
                    {s.total_sessions > 0 ? `${Math.round(s.total_minutes / s.total_sessions)}分钟` : "-"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pagination total={summaryTotal} offset={summaryOffset} limit={LIMIT} onChange={setSummaryOffset} />
        </div>
      )}

      {user?.role === "teacher" && ranking && ranking.length > 0 && (
        <div className="bg-card border border-border rounded-xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <Trophy size={18} className="text-amber-500" />
              学生成绩排名
            </h3>
            <span className="text-xs text-muted-foreground">按平均分降序</span>
          </div>
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                <th className={cn(thClass, "w-[60px]")}>排名</th>
                <th className={thClass}>学生</th>
                <th className={thClass}>学号</th>
                <th className={thClass}>训练次数</th>
                <th className={thClass}>平均分</th>
                <th className={thClass}>总分</th>
                <th className={thClass}>总时长</th>
              </tr>
            </thead>
            <tbody>
              {ranking.map((s) => (
                <tr key={s.user_id} className={cn("hover:bg-gray-50", s.rank <= 3 && "bg-amber-50")}>
                  <td className={tdClass}>
                    {s.rank === 1 ? (
                      <Medal size={20} className="text-amber-500" />
                    ) : s.rank === 2 ? (
                      <Medal size={20} className="text-gray-400" />
                    ) : s.rank === 3 ? (
                      <Medal size={20} className="text-amber-700" />
                    ) : (
                      <span className="text-muted-foreground font-semibold">{s.rank}</span>
                    )}
                  </td>
                  <td className={cn(tdClass, "font-medium")}>{s.display_name}</td>
                  <td className={cn(tdClass, "text-muted-foreground")}>{s.student_id || "-"}</td>
                  <td className={tdClass}>{s.total_sessions}</td>
                  <td className={cn(tdClass, "font-bold", s.avg_score != null ? "text-primary" : "text-gray-400")}>
                    {s.avg_score != null ? `${s.avg_score}分` : "-"}
                  </td>
                  <td className={cn(tdClass, "text-muted-foreground")}>{s.total_score > 0 ? `${s.total_score}分` : "-"}</td>
                  <td className={cn(tdClass, "text-muted-foreground")}>{s.total_minutes}分钟</td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pagination total={rankingTotal} offset={rankingOffset} limit={LIMIT} onChange={setRankingOffset} />
        </div>
      )}
    </>
  );
}

interface TooltipPayloadItem {
  color?: string;
  name?: string;
  value?: number;
}

function CustomTooltip({ active, payload, label }: { active?: boolean; payload?: TooltipPayloadItem[]; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-border rounded-lg px-3.5 py-2.5 shadow-md">
      <div className="text-xs text-muted-foreground mb-1">{label}</div>
      {payload.map((p, i) => (
        <div key={i} className="text-xs" style={{ color: p.color }}>
          {p.name}:{" "}
          <strong>
            {p.value}
            {p.name?.includes("得分") ? "分" : p.name?.includes("时长") ? "分钟" : "次"}
          </strong>
        </div>
      ))}
    </div>
  );
}

function EmptyChart() {
  return (
    <div className="text-center py-16 px-6 text-muted-foreground min-h-[200px]">
      <div className="text-gray-400 flex items-center justify-center mb-2.5">
        <BarChart3 size={42} />
      </div>
      <div>暂无该时间段的数据</div>
    </div>
  );
}
