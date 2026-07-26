import { useQuery } from "@tanstack/react-query";
import {
	Activity,
	BarChart3,
	ClipboardList,
	Clock,
	Medal,
	Target,
	TrendingUp,
	Trophy,
} from "lucide-react";
import { useState } from "react";
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
import {
	getStudentRanking,
	getTeacherSummary,
	getTrends,
} from "@/api";
import type { components } from "@/api/api-types.gen";
import { queryKeys } from "@/api/query-keys";
import { useToast } from "@/components/Toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartTooltip } from "@/components/ui/chart-tooltip";
import EmptyState from "@/components/ui/empty-state";
import HistoryTabs from "@/components/shell/HistoryTabs";
import PageHeader from "@/components/ui/page-header";
import Pagination from "@/components/ui/pagination";
import StatCard from "@/components/ui/stat-card";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { LegacyTabs } from "@/components/ui/tabs";
import { useBarColors, useChartTheme } from "@/hooks/useChartTheme";
import useAuthStore from "@/stores/authStore";
import type { User } from "@/types/store";
import { cn } from "@/utils/cn";
import { isAdminPermissions } from "@/utils/permissions";

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
	hasTeacherView: boolean;
	LIMIT?: number;
}

export default function Stats() {
	const [period, setPeriod] = useState("month");
	const [summaryOffset, setSummaryOffset] = useState(0);
	const [rankingOffset, setRankingOffset] = useState(0);
	const _toast = useToast();
	const user = useAuthStore((s) => s.user);
	const permissions = useAuthStore((s) => s.permissions);
	const hasTeacherView = isAdminPermissions(permissions);
	const LIMIT = 50;

	const { data: trends } = useQuery({
		queryKey: queryKeys.stats.trends(period),
		queryFn: () => getTrends(period).then((r) => r.data),
		staleTime: 2 * 60_000,
	});

	const { data: summaryData } = useQuery({
		queryKey: queryKeys.stats.teacherSummary({ offset: summaryOffset }),
		queryFn: () =>
			getTeacherSummary({ offset: summaryOffset, limit: LIMIT }).then(
				(r) => r.data,
			),
		enabled: hasTeacherView,
		staleTime: 2 * 60_000,
	});

	const { data: rankingData } = useQuery({
		queryKey: queryKeys.stats.ranking({ offset: rankingOffset }),
		queryFn: () =>
			getStudentRanking({ offset: rankingOffset, limit: LIMIT }).then(
				(r) => r.data,
			),
		enabled: hasTeacherView,
		staleTime: 2 * 60_000,
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
			hasTeacherView={hasTeacherView}
		/>
	);
}

export function StatsPage() {
	return <Stats />;
}

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
	hasTeacherView,
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
	const chartTheme = useChartTheme();
	const barColors = useBarColors();

	return (
		<>
			<HistoryTabs />
			<PageHeader
				title="训练统计"
				subtitle={
					hasTeacherView
						? "查看所有学生的训练趋势、时长和得分统计"
						: "查看你的训练投入与效果趋势"
				}
				icon={BarChart3}
			/>

			{trends && (
				<div className="grid grid-cols-2 gap-4 sm:grid-cols-4 mb-6">
					<StatCard
						icon={Activity}
						value={trends.total_sessions}
						label="总训练次数"
						color="blue"
					/>
					<StatCard
						icon={Clock}
						value={trends.total_minutes}
						label="总训练时长（分钟）"
						color="amber"
					/>
					<StatCard
						icon={Target}
						value={trends.avg_score != null ? `${trends.avg_score}分` : "-"}
						label="平均得分"
						color="green"
					/>
					<StatCard
						icon={TrendingUp}
						value={
							trends.total_sessions > 0
								? `${Math.round(trends.total_minutes / trends.total_sessions)}分钟`
								: "-"
						}
						label="平均每次训练时长"
						color="teal"
					/>
				</div>
			)}

			<div className="flex flex-col sm:flex-row sm:justify-end gap-4 mb-6 items-start sm:items-center">
				<LegacyTabs
					tabs={[
						{ key: "week", label: "近7天" },
						{ key: "month", label: "近30天" },
						{ key: "all", label: "全部" },
					]}
					activeTab={period}
					onChange={setPeriod}
				/>
			</div>

			<Card className="mb-6">
				<CardHeader className="pb-2">
					<CardTitle className="text-sm font-semibold">
						训练投入：次数与时长
					</CardTitle>
				</CardHeader>
				<CardContent>
					{hasData ? (
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
										value: "分钟",
										position: "insideRight",
										offset: -5,
										style: { fontSize: 12 },
									}}
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
								<Bar
									yAxisId="right"
									dataKey="minutes"
									name="训练时长"
									fill={barColors.minutes}
									radius={[4, 4, 0, 0]}
									barSize={28}
								/>
							</ComposedChart>
						</ResponsiveContainer>
					) : (
						<EmptyChart />
					)}
				</CardContent>
			</Card>

			<Card className="mb-6">
				<CardHeader className="pb-2">
					<CardTitle className="text-sm font-semibold">
						训练效果：次数与得分
					</CardTitle>
				</CardHeader>
				<CardContent>
					{hasData ? (
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
									domain={[0, 60]}
									tick={{ fontSize: 12 }}
									label={{
										value: "得分",
										position: "insideRight",
										offset: -5,
										style: { fontSize: 12 },
									}}
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
					) : (
						<EmptyChart />
					)}
				</CardContent>
			</Card>

			{hasTeacherView && summary && summary.length > 0 && (
				<Card className="mb-6">
					<CardHeader className="flex-row items-center justify-between pb-2">
						<CardTitle className="flex items-center gap-2 text-sm font-semibold">
							<ClipboardList size={18} />
							学生训练统计
						</CardTitle>
					</CardHeader>
					<div className="max-h-96 overflow-auto">
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>学生</TableHead>
									<TableHead>学号</TableHead>
									<TableHead>训练次数</TableHead>
									<TableHead>总时长（分钟）</TableHead>
									<TableHead>平均时长</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{summary.map((s) => (
									<TableRow key={s.user_id}>
										<TableCell>{s.display_name}</TableCell>
										<TableCell className="text-muted-foreground">
											{s.student_code}
										</TableCell>
										<TableCell>{s.total_sessions}</TableCell>
										<TableCell className="font-semibold">
											{s.total_minutes}
										</TableCell>
										<TableCell className="text-muted-foreground">
											{s.total_sessions > 0
												? `${Math.round(s.total_minutes / s.total_sessions)}分钟`
												: "-"}
										</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					</div>
					<CardContent>
						<Pagination
							total={summaryTotal}
							offset={summaryOffset}
							limit={LIMIT}
							onChange={setSummaryOffset}
						/>
					</CardContent>
				</Card>
			)}

			{hasTeacherView && ranking && ranking.length > 0 && (
				<Card>
					<CardHeader className="flex-row items-center justify-between pb-2">
						<CardTitle className="flex items-center gap-2 text-sm font-semibold">
							<Trophy size={18} className="text-amber-500" />
							学生成绩排名
						</CardTitle>
						<span className="text-xs text-muted-foreground">按平均分降序</span>
					</CardHeader>
					<div className="max-h-96 overflow-auto">
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead className="w-[60px]">排名</TableHead>
									<TableHead>学生</TableHead>
									<TableHead>学号</TableHead>
									<TableHead>训练次数</TableHead>
									<TableHead>平均分</TableHead>
									<TableHead>总分</TableHead>
									<TableHead>总时长</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{ranking.map((s) => (
									<TableRow
										key={s.user_id}
										className={cn(s.rank <= 3 && "bg-amber-50")}
									>
										<TableCell>
											{s.rank === 1 ? (
												<Medal size={20} className="text-amber-500" />
											) : s.rank === 2 ? (
												<Medal size={20} className="text-gray-400" />
											) : s.rank === 3 ? (
												<Medal size={20} className="text-amber-700" />
											) : (
												<span className="text-muted-foreground font-semibold">
													{s.rank}
												</span>
											)}
										</TableCell>
										<TableCell className="font-medium">
											{s.display_name}
										</TableCell>
										<TableCell className="text-muted-foreground">
											{s.student_id || "-"}
										</TableCell>
										<TableCell>{s.total_sessions}</TableCell>
										<TableCell
											className={cn(
												"font-bold",
												s.avg_score != null ? "text-primary" : "text-muted-foreground",
											)}
										>
											{s.avg_score != null ? `${s.avg_score}分` : "-"}
										</TableCell>
										<TableCell className="text-muted-foreground">
											{s.total_score > 0 ? `${s.total_score}分` : "-"}
										</TableCell>
										<TableCell className="text-muted-foreground">
											{s.total_minutes}分钟
										</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					</div>
					<CardContent>
						<Pagination
							total={rankingTotal}
							offset={rankingOffset}
							limit={LIMIT}
							onChange={setRankingOffset}
						/>
					</CardContent>
				</Card>
			)}
		</>
	);
}

function EmptyChart() {
	return (
		<EmptyState
			icon={BarChart3}
			title="暂无该时间段的数据"
			className="min-h-[200px]"
		/>
	);
}
