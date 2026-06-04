import { useQuery } from "@tanstack/react-query";
import { Activity, Clock, FileText, Medal, Target, TrendingUp, User as UserIcon } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { getStudentDetail } from "@/api/api-client";
import type { components } from "@/api/api-types.gen";
import Layout from "@/components/Layout";
import PageHeader from "@/components/ui/PageHeader";
import { cn } from "@/lib/utils";

type Schemas = components["schemas"];
type StudentDetail = Schemas["StudentDetail"];

interface RecentRecord {
  id: number;
  case_name: string;
  status: string;
  score_total: number | null;
  start_time: string;
}

interface DailyItem {
  created_at: string;
  date: string;
  sessions: number;
  avg_score: number | null;
}

interface ChartTooltipProps {
  active?: boolean;
  payload?: { color: string; name: string; value: number }[];
  label?: string;
}

function ChartTooltip({ active, payload, label }: ChartTooltipProps) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-gray-200 rounded-[var(--radius-md)] px-3.5 py-2.5 shadow-md">
      <div className="text-xs text-gray-500 mb-1">{label}</div>
      {payload.map((p, i) => (
        <div key={i} className="text-sm" style={{ color: p.color }}>
          {p.name}:{" "}
          <strong>
            {p.value}
            {p.name.includes("得分") ? "分" : "次"}
          </strong>
        </div>
      ))}
    </div>
  );
}

export default function UserDetailPage() {
  const { userId } = useParams<{ userId: string }>();
  const navigate = useNavigate();

  const { data: student, isLoading } = useQuery({
    queryKey: ["studentDetail", userId],
    queryFn: () => getStudentDetail(Number(userId)).then((r) => r.data),
    enabled: !!userId,
  });

  if (isLoading || !student) {
    return (
      <Layout>
        <div className="text-center py-12 text-gray-500">加载中...</div>
      </Layout>
    );
  }

  const daily = (student.daily || []) as DailyItem[];
  const hasChartData = daily.length > 0;
  const formatDate = (d: StudentDetail) => new Date(d.created_at).toLocaleDateString("zh-CN");
  const recentRecords = (student.recent_records || []) as RecentRecord[];

  return (
    <Layout>
      <PageHeader
        title={student.display_name}
        subtitle={`学生详情 · 学号: ${student.student_id || "-"} · 注册: ${formatDate(student)}`}
        icon={UserIcon}
        backTo="/admin/users"
      />

      <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-3.5 mb-6">
        <div className="bg-white rounded-[var(--radius-lg)] p-[18px_20px] border border-gray-200 flex items-center gap-3.5">
          <div className="w-11 h-11 rounded-[10px] flex items-center justify-center shrink-0 bg-blue-50 text-blue-500">
            <Activity size={22} />
          </div>
          <div>
            <div className="text-2xl font-bold leading-tight">{student.total_sessions}</div>
            <div className="text-xs text-gray-500">总训练次数</div>
          </div>
        </div>
        <div className="bg-white rounded-[var(--radius-lg)] p-[18px_20px] border border-gray-200 flex items-center gap-3.5">
          <div className="w-11 h-11 rounded-[10px] flex items-center justify-center shrink-0 bg-amber-50 text-amber-500">
            <Clock size={22} />
          </div>
          <div>
            <div className="text-2xl font-bold leading-tight">{student.total_minutes}</div>
            <div className="text-xs text-gray-500">总训练时长（分钟）</div>
          </div>
        </div>
        <div className="bg-white rounded-[var(--radius-lg)] p-[18px_20px] border border-gray-200 flex items-center gap-3.5">
          <div className="w-11 h-11 rounded-[10px] flex items-center justify-center shrink-0 bg-green-50 text-green-500">
            <Target size={22} />
          </div>
          <div>
            <div className="text-2xl font-bold leading-tight">{student.avg_score != null ? `${student.avg_score}分` : "-"}</div>
            <div className="text-xs text-gray-500">平均得分</div>
          </div>
        </div>
        <div className="bg-white rounded-[var(--radius-lg)] p-[18px_20px] border border-gray-200 flex items-center gap-3.5">
          <div className="w-11 h-11 rounded-[10px] flex items-center justify-center shrink-0 bg-cyan-50 text-cyan-500">
            <Medal size={22} />
          </div>
          <div>
            <div className="text-2xl font-bold leading-tight">
              {student.total_sessions > 0 ? `${Math.round(student.total_minutes / student.total_sessions)}分钟` : "-"}
            </div>
            <div className="text-xs text-gray-500">平均每次训练时长</div>
          </div>
        </div>
      </div>

      {hasChartData && (
        <div className="mb-5">
          <h3 className="flex items-center gap-2 mb-4">
            <TrendingUp size={18} /> 近30天训练趋势
          </h3>
          <ResponsiveContainer width="100%" height={280}>
            <ComposedChart data={daily} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="date" tick={{ fontSize: 12 }} tickFormatter={(v: string) => v.slice(5)} />
              <YAxis yAxisId="left" tick={{ fontSize: 12 }} label={{ value: "次数", position: "insideLeft", offset: -5, style: { fontSize: 12 } }} />
              <YAxis
                yAxisId="right"
                orientation="right"
                tick={{ fontSize: 12 }}
                label={{ value: "得分", position: "insideRight", offset: -5, style: { fontSize: 12 } }}
                domain={[0, 100]}
              />
              <Tooltip content={<ChartTooltip />} />
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
        </div>
      )}

      <div className="bg-white rounded-[var(--radius-xl)] p-6 border border-gray-200">
        <div className="flex items-center justify-between mb-4">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <FileText size={18} /> 最近训练记录 ({recentRecords.length}条)
          </h3>
        </div>
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              <th className="text-left px-4 py-2.5 bg-gray-50 text-gray-500 font-semibold text-xs uppercase tracking-wider border-b border-gray-200">病例</th>
              <th className="text-left px-4 py-2.5 bg-gray-50 text-gray-500 font-semibold text-xs uppercase tracking-wider border-b border-gray-200">状态</th>
              <th className="text-left px-4 py-2.5 bg-gray-50 text-gray-500 font-semibold text-xs uppercase tracking-wider border-b border-gray-200">得分</th>
              <th className="text-left px-4 py-2.5 bg-gray-50 text-gray-500 font-semibold text-xs uppercase tracking-wider border-b border-gray-200">
                开始时间
              </th>
              <th className="text-left px-4 py-2.5 bg-gray-50 text-gray-500 font-semibold text-xs uppercase tracking-wider border-b border-gray-200">操作</th>
            </tr>
          </thead>
          <tbody>
            {recentRecords.map((r) => (
              <tr key={r.id} className="group">
                <td className="px-4 py-3 border-b border-gray-200 group-hover:bg-gray-50">{r.case_name}</td>
                <td className="px-4 py-3 border-b border-gray-200 group-hover:bg-gray-50">
                  <span
                    className={cn(
                      "inline-block px-2.5 py-0.5 rounded-xl text-xs font-semibold",
                      r.status === "completed" ? "bg-green-50 text-green-700" : "bg-blue-50 text-blue-600",
                    )}
                  >
                    {r.status === "completed" ? "已完成" : "进行中"}
                  </span>
                </td>
                <td
                  className={cn(
                    "px-4 py-3 border-b border-gray-200 group-hover:bg-gray-50 font-semibold",
                    r.score_total != null ? "text-primary" : "text-gray-500",
                  )}
                >
                  {r.score_total != null ? `${r.score_total}分` : "未评分"}
                </td>
                <td className="px-4 py-3 border-b border-gray-200 group-hover:bg-gray-50 text-sm text-gray-500">
                  {new Date(r.start_time).toLocaleString("zh-CN")}
                </td>
                <td className="px-4 py-3 border-b border-gray-200 group-hover:bg-gray-50">
                  <button
                    className="inline-flex items-center justify-center h-7 gap-1 rounded-[min(var(--radius-md),12px)] px-2.5 text-sm font-medium hover:bg-muted hover:text-foreground transition-all"
                    onClick={() => navigate(`/record/${r.id}`)}
                  >
                    查看详情
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Layout>
  );
}
