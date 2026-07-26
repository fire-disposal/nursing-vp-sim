import { useQuery } from "@tanstack/react-query";
import { GraduationCap, TrendingUp, Users } from "lucide-react";
import type { components } from "@/api/api-types.gen";
import { getAssignments } from "@/api/assignments";
import { queryKeys } from "@/api/query-keys";
import { getRecords, getStats } from "@/api";
import StatCard from "@/components/ui/stat-card";
import useAuthStore from "@/stores/authStore";
import type { RecordExtended } from "@/types/record";
import { ActivityTimeline, type ActivityEvent } from "./ActivityTimeline";
import { AssignmentOverview } from "./AssignmentOverview";
import { RingProgress } from "./RingProgress";

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
		queryKey: ["assignments", "admin"],
		queryFn: () => getAssignments().then((r) => r.data),
		staleTime: 60_000,
	});

	const records = (recordsData?.items ?? []) as RecordExtended[];
	const assignments = (assignmentsData?.items ?? []) as AssignmentListItem[];

	const completedRecords = records.filter(
		(r: RecordExtended) => r.status === "completed",
	);
	const todayRecords = records.filter((r: RecordExtended) => {
		const d = new Date(r.start_time);
		const today = new Date();
		return d.toDateString() === today.toDateString();
	});
	const completedWeek = records.filter((r: RecordExtended) => {
		if (r.status !== "completed") return false;
		const d = new Date(r.start_time);
		const now = new Date();
		const weekAgo = new Date(now.getTime() - 7 * 24 * 3600_000);
		return d >= weekAgo;
	});

	const totalStudents = stats?.total_students ?? 0;
	const activeStudentCount = new Set(
		todayRecords.map((r: RecordExtended) => r.user_display_name),
	).size;
	const pendingReview = completedRecords.filter((r: RecordExtended) => {
		const s = r as RecordExtended & { score_reviewed?: boolean };
		return !s.score_reviewed;
	}).length;

	const hour = new Date().getHours();
	const greeting =
		hour < 12 ? "上午好" : hour < 18 ? "下午好" : "晚上好";

	const recentEvents: ActivityEvent[] = records.slice(0, 8).map(
		(r: RecordExtended) => ({
			id: r.id,
			time: new Date(r.start_time).toLocaleTimeString("zh-CN", {
				hour: "2-digit",
				minute: "2-digit",
			}),
			studentName: r.user_display_name ?? "未知",
			action:
				r.status === "completed"
					? `完成了 ${r.case_name ?? "训练"}`
					: "开始了训练",
			meta: r.score_total != null ? `${r.score_total}分` : undefined,
			metaColor:
				r.score_total != null
					? SCORE_COLOR(r.score_total)
					: undefined,
		}),
	);

	return (
		<div className="space-y-6">
			<div>
				<h1 className="text-xl font-bold">
					{greeting}，{user?.display_name || "老师"}
				</h1>
				<p className="text-sm text-muted-foreground mt-1">
					本周截至{" "}
					{new Date().toLocaleDateString("zh-CN", {
						month: "long",
						day: "numeric",
					})}
				</p>
			</div>

			<div className="grid grid-cols-1 md:grid-cols-4 gap-4">
				<StatCard
					icon={Users}
					value={activeStudentCount}
					label="今日活跃学生"
					color="teal"
					className="md:col-span-2"
				/>

				<StatCard
					icon={GraduationCap}
					value={`${pendingReview} 份`}
					label="待批阅作业"
					color={pendingReview > 5 ? "amber" : "green"}
				/>

				<div className="rounded-xl ring-1 ring-foreground/10 bg-card p-4 flex items-center justify-center">
					<RingProgress
						value={completedWeek.length}
						max={totalStudents || 1}
						label="本周训练完成率"
						subtitle={`${completedWeek.length}人 / ${totalStudents}人`}
					/>
				</div>

				<div className="md:col-span-4">
					<AssignmentOverview assignments={assignments} />
				</div>

				<div className="md:col-span-4">
					<div className="rounded-xl ring-1 ring-foreground/10 bg-card p-4">
						<h3 className="text-sm font-medium mb-1">
							最近训练动态
						</h3>
						<ActivityTimeline events={recentEvents} />
					</div>
				</div>
			</div>
		</div>
	);
}
