import { useQuery } from "@tanstack/react-query";
import { Clock, Medal, TrendingUp, Trophy, Zap } from "lucide-react";
import {
	Bar,
	BarChart,
	CartesianGrid,
	Line,
	LineChart,
	ResponsiveContainer,
	Tooltip,
	XAxis,
	YAxis,
} from "recharts";
import type { components } from "@/api/api-types.gen";
import { getStudentTrend } from "@/api/scoreboard";
import { queryKeys } from "@/api/query-keys";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import EmptyState from "@/components/ui/empty-state";
import { ChartTooltip } from "@/components/ui/chart-tooltip";
import { useBarColors, useChartTheme } from "@/hooks/useChartTheme";
import { cn } from "@/lib/utils";

type StudentTrendResponse = components["schemas"]["StudentTrendResponse"];

export interface TrendScope {
	case_id?: number | null;
	class_id?: number | null;
	assignment_id?: string | null;
	assignment_status?: string | null;
	include_free?: boolean;
}

interface StudentTrendDialogProps {
	open: boolean;
	userId: number | null;
	scope: TrendScope;
	onOpenChange: (open: boolean) => void;
}

export function formatDuration(seconds: number | null | undefined): string {
	if (seconds == null || seconds < 0) return "-";
	const total = Math.round(seconds);
	const h = Math.floor(total / 3600);
	const m = Math.floor((total % 3600) / 60);
	const s = total % 60;
	if (h > 0) return `${h}小时${m}分`;
	if (m > 0) return `${m}分${s}秒`;
	return `${s}秒`;
}

const TREND_LABELS: Record<string, string> = {
	up: "进步",
	flat: "平稳",
	down: "退步",
	none: "暂无",
};

const TREND_COLORS: Record<string, string> = {
	up: "text-success-foreground",
	flat: "text-muted-foreground",
	down: "text-destructive",
};

function trendBadge(trend: string, delta: number | null | undefined) {
	const label = TREND_LABELS[trend] ?? "暂无";
	if (delta == null) {
		return <span className="text-sm text-muted-foreground">—</span>;
	}
	const arrow = trend === "up" ? "▲" : trend === "down" ? "▼" : "•";
	return (
		<span className={cn("font-medium", TREND_COLORS[trend] ?? "")}>
			{arrow} {delta >= 0 ? "+" : ""}
			{delta.toFixed(1)} 分
			<span className="ml-1 text-xs opacity-80">({label})</span>
		</span>
	);
}

/** 分层与后端一致：good ≥ 85，medium ≥ 60，poor < 60（0-100 分制）。 */
const TIER_TEXT_COLOR: Record<string, string> = {
	good: "text-success-foreground",
	medium: "text-warning-foreground",
	poor: "text-destructive",
	none: "text-muted-foreground",
};

function tierOf(score: number | null | undefined): string {
	if (score == null) return "none";
	if (score >= 85) return "good";
	if (score >= 60) return "medium";
	return "poor";
}

export default function StudentTrendDialog({
	open,
	userId,
	scope,
	onOpenChange,
}: StudentTrendDialogProps) {
	const chartTheme = useChartTheme();
	const barColors = useBarColors();

	const { data, isLoading } = useQuery({
		queryKey: queryKeys.scoreboard.trend(userId, {
			case_id: scope.case_id ?? null,
			class_id: scope.class_id ?? null,
			assignment_id: scope.assignment_id ?? null,
			assignment_status: scope.assignment_status ?? null,
			include_free: scope.include_free ?? false,
		}),
		queryFn: () =>
			userId != null
				? getStudentTrend(userId, {
						case_id: scope.case_id ?? null,
						class_id: scope.class_id ?? null,
						assignment_id: scope.assignment_id ?? null,
						assignment_status: scope.assignment_status ?? null,
						include_free: scope.include_free ?? false,
					}).then((r) => r.data)
				: Promise.resolve(null),
		enabled: open && userId != null,
		staleTime: 60_000,
	});

	const trend = data as StudentTrendResponse | null | undefined;
	const trendRecords = trend?.records ?? [];
	const chartData =
		trendRecords.map((r, i) => ({
			name: `第${i + 1}次`,
			label: `第${i + 1}次 · ${r.case_name || `病例#${r.case_id}`}`,
			score: r.score,
			minutes: Math.round(r.duration_seconds / 60),
			assignment: r.assignment_title ?? "自主训练",
		})) ?? [];

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent size="lg" title="成绩趋势" maxWidth={760}>
				<DialogTitle className="sr-only">成绩趋势</DialogTitle>
				{isLoading ? (
					<div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
						加载中...
					</div>
				) : !trend || trendRecords.length === 0 ? (
					<EmptyState
						title="暂无成绩记录"
						description="该学生在当前筛选范围内没有已评分的训练记录"
					/>
				) : (
					<div className="space-y-5">
						<div className="flex flex-wrap items-center justify-between gap-2">
							<div>
								<p className="text-lg font-bold text-foreground">
									{trend.display_name}
									{trend.class_name && (
										<span className="ml-2 text-sm font-normal text-muted-foreground">
											{trend.class_name}
										</span>
									)}
								</p>
								<p className="text-xs text-muted-foreground">
									{trend.student_id ?? ""} · 共 {trend.training_count} 次训练 · 覆盖{" "}
									{new Set(trendRecords.map((r) => r.case_id)).size} 个病例
								</p>
							</div>
							{trend.progress_delta != null && (
								<span className="inline-flex items-center gap-1 rounded-lg bg-muted px-2.5 py-1 text-xs text-muted-foreground">
									<TrendingUp size={14} />
									进步幅度：{trendBadge(trend.progress_trend, trend.progress_delta)}
								</span>
							)}
						</div>

						<div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
							<div className="rounded-xl bg-muted/50 p-3">
								<div className="flex items-center gap-1.5 text-xs text-muted-foreground">
									<Zap size={13} /> 训练次数
								</div>
								<p className="mt-1 text-lg font-bold text-foreground">
									{trend.training_count}
								</p>
							</div>
							<div className="rounded-xl bg-muted/50 p-3">
								<div className="flex items-center gap-1.5 text-xs text-muted-foreground">
									<Clock size={13} /> 总用时
								</div>
								<p className="mt-1 text-lg font-bold text-foreground">
									{formatDuration(trend.total_duration_seconds)}
								</p>
							</div>
							<div className="rounded-xl bg-muted/50 p-3">
								<div className="flex items-center gap-1.5 text-xs text-muted-foreground">
									<Medal size={13} /> 平均分
								</div>
								<p
									className={cn(
										"mt-1 text-lg font-bold",
										TIER_TEXT_COLOR[tierOf(trend.avg_score)],
									)}
								>
									{trend.avg_score ?? "-"}
								</p>
							</div>
							<div className="rounded-xl bg-muted/50 p-3">
								<div className="flex items-center gap-1.5 text-xs text-muted-foreground">
									<Trophy size={13} /> 最高分
								</div>
								<p className="mt-1 text-lg font-bold text-foreground">
									{trend.best_score ?? "-"}
								</p>
							</div>
							<div className="rounded-xl bg-muted/50 p-3">
								<div className="flex items-center gap-1.5 text-xs text-muted-foreground">
									<TrendingUp size={13} /> 进步幅度
								</div>
								<p className="mt-1 text-lg font-bold">
									{trendBadge(trend.progress_trend, trend.progress_delta)}
								</p>
							</div>
						</div>

						<div className="space-y-1">
							<p className="text-sm font-medium text-foreground">分数趋势</p>
							<div className="h-52 w-full">
								<ResponsiveContainer width="100%" height="100%">
									<LineChart data={chartData}>
										<CartesianGrid strokeDasharray="3 3" stroke={chartTheme.grid} />
										<XAxis dataKey="name" stroke={chartTheme.axisTick} fontSize={11} />
										<YAxis domain={[0, 100]} stroke={chartTheme.axisTick} fontSize={11} width={32} />
										<Tooltip
											content={<ChartTooltip unit="分" />}
											labelFormatter={(label, payload) =>
												payload?.[0]?.payload?.label ?? label
											}
											cursor={{ stroke: chartTheme.grid }}
										/>
										<Line
											type="monotone"
											dataKey="score"
											name="得分"
											stroke={barColors.score}
											strokeWidth={2}
											dot={{ r: 3 }}
											activeDot={{ r: 5 }}
										/>
									</LineChart>
								</ResponsiveContainer>
							</div>
						</div>

						<div className="space-y-1">
							<p className="text-sm font-medium text-foreground">单次训练用时（分钟）</p>
							<div className="h-40 w-full">
								<ResponsiveContainer width="100%" height="100%">
									<BarChart data={chartData}>
										<CartesianGrid strokeDasharray="3 3" stroke={chartTheme.grid} />
										<XAxis dataKey="name" stroke={chartTheme.axisTick} fontSize={11} />
										<YAxis stroke={chartTheme.axisTick} fontSize={11} width={32} />
										<Tooltip
											content={<ChartTooltip unit="分钟" />}
											labelFormatter={(label, payload) =>
												`${payload?.[0]?.payload?.label ?? label} · ${
													payload?.[0]?.payload?.assignment ?? ""
												}`
											}
											cursor={{ fill: "var(--border)", opacity: 0.4 }}
										/>
										<Bar dataKey="minutes" name="用时" fill={barColors.minutes} radius={[4, 4, 0, 0]} />
									</BarChart>
								</ResponsiveContainer>
							</div>
						</div>
					</div>
				)}
			</DialogContent>
		</Dialog>
	);
}
