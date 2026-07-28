import { useQuery } from "@tanstack/react-query";
import {
	Activity,
	Clock,
	FileText,
	Medal,
	Target,
	TrendingUp,
	User as UserIcon,
} from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import {
	Bar,
	CartesianGrid,
	ComposedChart,
	Legend,
	Line,
	ResponsiveContainer,
	Tooltip,
	XAxis,
	YAxis,
} from "recharts";
import { getStudentDetail } from "@/api";
import type { components } from "@/api/api-types.gen";
import { queryKeys } from "@/api/query-keys";
import Badge from "@/components/ui/badge";
import Button from "@/components/ui/button";
import { ChartTooltip } from "@/components/ui/chart-tooltip";
import PageHeader from "@/components/ui/page-header";
import { useBarColors, useChartTheme } from "@/hooks/useChartTheme";
import { cn } from "@/lib/utils";
import { statCardClass, statIconClass } from "@/utils/styles";

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

/** Safely coerce unknown array to typed array, discarding entries that don't match the shape. */
function asRecentRecords(arr: unknown): RecentRecord[] {
	if (!Array.isArray(arr)) return [];
	return arr.filter(
		(item): item is RecentRecord =>
			typeof item === "object" &&
			item !== null &&
			typeof (item as RecentRecord).id === "number" &&
			typeof (item as RecentRecord).case_name === "string",
	);
}

function asDailyItems(arr: unknown): DailyItem[] {
	if (!Array.isArray(arr)) return [];
	return arr.filter(
		(item): item is DailyItem =>
			typeof item === "object" &&
			item !== null &&
			typeof (item as DailyItem).date === "string" &&
			typeof (item as DailyItem).sessions === "number",
	);
}


export default function UserDetailPage() {
	const { userId } = useParams<{ userId: string }>();
	const navigate = useNavigate();
	const chartTheme = useChartTheme();
	const barColors = useBarColors();

	const { data: student, isLoading, isError, error } = useQuery({
		queryKey: queryKeys.admin.users.studentDetail(userId),
		queryFn: () => getStudentDetail(Number(userId)).then((r) => r.data),
		enabled: !!userId,
		staleTime: 2 * 60_000,
	});

	if (isLoading) {
		return <div className="text-center py-12 text-muted-foreground">加载中...</div>;
	}
	if (isError) {
		return <div className="text-center py-12 text-destructive">加载失败：{(error as Error)?.message}</div>;
	}
	if (!student) {
		return <div className="text-center py-12 text-muted-foreground">未找到用户</div>;
	}

	const daily = asDailyItems(student.daily);
	const hasChartData = daily.length > 0;
	const formatDate = (d: StudentDetail) =>
		new Date(d.created_at).toLocaleDateString("zh-CN");
	const recentRecords = asRecentRecords(student.recent_records);

	return (
		<>
			<PageHeader
				title={student.display_name}
				subtitle={`学生详情 · 学号: ${student.student_id || "-"} · 注册: ${formatDate(student)}`}
				icon={UserIcon}
				backTo="/admin/users"
			/>

			<div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-3.5 mb-6">
				<div className={statCardClass}>
					<div className={cn(statIconClass, "bg-info text-primary")}>
						<Activity size={22} />
					</div>
					<div>
						<div className="text-2xl font-bold leading-tight">
							{student.total_sessions}
						</div>
						<div className="text-xs text-muted-foreground">总训练次数</div>
					</div>
				</div>
				<div className={statCardClass}>
					<div className={cn(statIconClass, "bg-warning text-warning-foreground")}>
						<Clock size={22} />
					</div>
					<div>
						<div className="text-2xl font-bold leading-tight">
							{student.total_minutes}
						</div>
						<div className="text-xs text-muted-foreground">
							总训练时长（分钟）
						</div>
					</div>
				</div>
				<div className={statCardClass}>
					<div className={cn(statIconClass, "bg-success text-success-foreground")}>
						<Target size={22} />
					</div>
					<div>
						<div className="text-2xl font-bold leading-tight">
							{student.avg_score != null ? `${student.avg_score}分` : "-"}
						</div>
						<div className="text-xs text-muted-foreground">平均得分</div>
					</div>
				</div>
				<div className={statCardClass}>
					<div className={cn(statIconClass, "bg-cyan-50 text-cyan-500")}>
						<Medal size={22} />
					</div>
					<div>
						<div className="text-2xl font-bold leading-tight">
							{student.total_sessions > 0
								? `${Math.round(student.total_minutes / student.total_sessions)}分钟`
								: "-"}
						</div>
						<div className="text-xs text-muted-foreground">
							平均每次训练时长
						</div>
					</div>
				</div>
			</div>

			{hasChartData && (
				<div className="mb-5">
					<h3 className="flex items-center gap-2 mb-4 text-base font-semibold">
						<TrendingUp size={18} /> 近30天训练趋势
					</h3>
					<ResponsiveContainer width="100%" height={280}>
						<ComposedChart
							data={daily}
							margin={{ top: 5, right: 20, left: 0, bottom: 5 }}
						>
							<CartesianGrid strokeDasharray="3 3" stroke={chartTheme.grid} />
							<XAxis
								dataKey="date"
								tick={{ fontSize: 12 }}
								tickFormatter={(v: string) => v.slice(5)}
							/>
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
									value: "得分",
									position: "insideRight",
									offset: -5,
									style: { fontSize: 12 },
								}}
								domain={[0, 100]}
							/>
							<Tooltip content={<ChartTooltip />} />
							<Legend />
							<Bar
								yAxisId="left"
								dataKey="sessions"
								name="训练次数"
								fill={barColors.sessions}
								radius={[4, 4, 0, 0]}
								barSize={28}
							/>
							<Line
								yAxisId="right"
								type="monotone"
								dataKey="avg_score"
								name="平均得分"
								stroke={barColors.score}
								strokeWidth={2.5}
								dot={{ r: 4, fill: barColors.score }}
								connectNulls
							/>
						</ComposedChart>
					</ResponsiveContainer>
				</div>
			)}

			<div className="bg-card rounded-xl shadow-e1 p-6 border border-border overflow-x-auto">
				<div className="flex items-center justify-between mb-4">
					<h3 className="flex items-center gap-2 text-sm font-semibold">
						<FileText size={18} /> 最近训练记录 ({recentRecords.length}条)
					</h3>
				</div>
				<table className="w-full border-collapse text-sm">
					<thead>
						<tr>
							<th className="sticky top-0 z-10 text-left px-4 py-2.5 bg-muted text-muted-foreground font-semibold text-xs uppercase tracking-wider border-b border-border">
								病例
							</th>
							<th className="sticky top-0 z-10 text-left px-4 py-2.5 bg-muted text-muted-foreground font-semibold text-xs uppercase tracking-wider border-b border-border">
								状态
							</th>
							<th className="sticky top-0 z-10 text-left px-4 py-2.5 bg-muted text-muted-foreground font-semibold text-xs uppercase tracking-wider border-b border-border">
								得分
							</th>
							<th className="sticky top-0 z-10 text-left px-4 py-2.5 bg-muted text-muted-foreground font-semibold text-xs uppercase tracking-wider border-b border-border">
								开始时间
							</th>
							<th className="sticky top-0 z-10 text-left px-4 py-2.5 bg-muted text-muted-foreground font-semibold text-xs uppercase tracking-wider border-b border-border">
								操作
							</th>
						</tr>
					</thead>
					<tbody>
						{recentRecords.map((r) => (
							<tr key={r.id} className="group hover:bg-muted">
								<td className="px-4 py-3 border-b border-border">
									{r.case_name}
								</td>
								<td className="px-4 py-3 border-b border-border">
									<Badge
										variant={r.status === "completed" ? "success" : "info"}
									>
										{r.status === "completed" ? "已完成" : "进行中"}
									</Badge>
								</td>
								<td
									className={cn(
										"px-4 py-3 border-b border-border font-semibold",
										r.score_total != null
											? "text-primary"
											: "text-muted-foreground",
									)}
								>
									{r.score_total != null ? `${r.score_total}分` : "未评分"}
								</td>
								<td className="px-4 py-3 border-b border-border text-sm text-muted-foreground">
									{new Date(r.start_time).toLocaleString("zh-CN")}
								</td>
								<td className="px-4 py-3 border-b border-border">
									<Button
										variant="ghost"
										size="sm"
										onClick={() => navigate(`/record/${r.id}`)}
									>
										查看详情
									</Button>
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
		</>
	);
}
