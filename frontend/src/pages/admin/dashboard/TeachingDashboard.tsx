import { useQuery } from "@tanstack/react-query";
import { BarChart3, ClipboardList, Target, TrendingUp, Users } from "lucide-react";
import type { components } from "@/api/api-types.gen";
import { getAssignments } from "@/api/assignments";
import { queryKeys } from "@/api/query-keys";
import { getRecords, getStats } from "@/api";
import StatCard from "@/components/ui/stat-card";
import useAuthStore from "@/stores/authStore";
import type { RecordExtended } from "@/types/record";
import { ActivityTimeline, type ActivityEvent } from "./ActivityTimeline";
import { AssignmentOverview } from "./AssignmentOverview";

type AdminStats = components["schemas"]["AdminStats"];
type AssignmentListItem = components["schemas"]["AssignmentListItem"];

const SCORE_COLOR = (s: number): ActivityEvent["metaColor"] =>
  s >= 85 ? "green" : s >= 60 ? "amber" : "red";

export function TeachingDashboard() {
  const user = useAuthStore((s) => s.user);

  const { data: stats } = useQuery({
    queryKey: queryKeys.stats.admin(),
    queryFn: () => getStats().then((r) => r.data as AdminStats),
    staleTime: 60_000,
  });

  const { data: recordsData } = useQuery({
    queryKey: queryKeys.training.records({ limit: 10 }),
    queryFn: () => getRecords({ limit: 10 }).then((r) => r.data),
    staleTime: 30_000,
  });

  const { data: assignmentsData } = useQuery({
    queryKey: queryKeys.assignments.admin(),
    queryFn: () => getAssignments().then((r) => r.data),
    staleTime: 60_000,
  });

  const records = (recordsData?.items ?? []) as RecordExtended[];
  const assignments = (assignmentsData?.items ?? []) as AssignmentListItem[];

  const completedRecords = records.filter((r: RecordExtended) => r.status === "completed");
  const todayRecords = records.filter((r: RecordExtended) => {
    const d = new Date(r.start_time);
    return d.toDateString() === new Date().toDateString();
  });
  const completedWeek = records.filter((r: RecordExtended) => {
    if (r.status !== "completed") return false;
    return new Date(r.start_time) >= new Date(Date.now() - 7 * 24 * 3600_000);
  });

  const totalStudents = stats?.total_students ?? 0;
  const activeStudentCount = new Set(todayRecords.map((r: RecordExtended) => r.user_display_name)).size;
  const pendingReview = completedRecords.filter(
    (r: RecordExtended) => !(r as RecordExtended & { score_reviewed?: boolean }).score_reviewed,
  ).length;
  const avgScore = stats?.average_score;
  const avgDuration = stats?.avg_duration_min;
  const completionRate = totalStudents > 0 ? Math.round((completedWeek.length / totalStudents) * 100) : 0;

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "上午好" : hour < 18 ? "下午好" : "晚上好";

  const recentEvents: ActivityEvent[] = records.slice(0, 8).map((r: RecordExtended) => ({
    id: r.id,
    time: new Date(r.start_time).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }),
    studentName: r.user_display_name ?? "未知",
    action: r.status === "completed" ? `完成了 ${r.case_name ?? "训练"}` : "开始了训练",
    meta: r.score_total != null ? `${r.score_total}分` : undefined,
    metaColor: r.score_total != null ? SCORE_COLOR(r.score_total) : undefined,
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold">{greeting}，{user?.display_name || "老师"}</h1>
        <p className="text-sm text-muted-foreground mt-1">
          本周截至 {new Date().toLocaleDateString("zh-CN", { month: "long", day: "numeric" })}
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard icon={Users} value={activeStudentCount} label="今日活跃学生" color="teal" />
        <StatCard icon={TrendingUp} value={stats?.today_records ?? 0} label="今日训练次数" color="blue" />
        <StatCard
          icon={Target}
          value={avgScore != null ? `${avgScore}分` : "--"}
          label="平均得分"
          color={avgScore != null && avgScore >= 80 ? "green" : avgScore != null && avgScore >= 60 ? "amber" : "red"}
        />
        <StatCard icon={ClipboardList} value={pendingReview} label="待批阅训练" color={pendingReview > 5 ? "red" : "green"} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="rounded-xl ring-1 ring-foreground/10 bg-card p-4 flex flex-col justify-center">
          <div className="text-xs text-muted-foreground mb-1">本周训练完成率</div>
          <div className="flex items-baseline gap-1.5">
            <span className="text-2xl font-bold">{completionRate}%</span>
            <span className="text-xs text-muted-foreground">{completedWeek.length}/{totalStudents} 人</span>
          </div>
          <div className="mt-2 h-2 rounded-full bg-muted overflow-hidden">
            <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${completionRate}%` }} />
          </div>
        </div>
        <div className="rounded-xl ring-1 ring-foreground/10 bg-card p-4 flex flex-col justify-center">
          <div className="text-xs text-muted-foreground mb-1">平均训练时长</div>
          <div className="flex items-baseline gap-1.5">
            <span className="text-2xl font-bold">{avgDuration != null ? avgDuration : "--"}</span>
            {avgDuration != null && <span className="text-xs text-muted-foreground">分钟</span>}
          </div>
        </div>
        <div className="rounded-xl ring-1 ring-foreground/10 bg-card p-4 flex flex-col justify-center">
          <div className="text-xs text-muted-foreground mb-1">总学生 / 总训练</div>
          <div className="flex items-baseline gap-1.5">
            <span className="text-2xl font-bold">{totalStudents}</span>
            <span className="text-xs text-muted-foreground">/ {stats?.total_records ?? 0}</span>
          </div>
        </div>
      </div>

      <AssignmentOverview assignments={assignments} />

      <div className="rounded-xl ring-1 ring-foreground/10 bg-card p-4">
        <h3 className="text-sm font-medium mb-2 flex items-center gap-2">
          <BarChart3 size={16} className="text-muted-foreground" />最近训练动态
        </h3>
        <ActivityTimeline events={recentEvents} />
      </div>
    </div>
  );
}
