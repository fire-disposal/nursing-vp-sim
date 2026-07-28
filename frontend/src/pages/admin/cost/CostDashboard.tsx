import { useQuery } from "@tanstack/react-query";
import {
	CircleDollarSign,
	TrendingUp,
	Volume2,
	Users,
} from "lucide-react";
import {
	Area,
	AreaChart,
	CartesianGrid,
	ResponsiveContainer,
	Tooltip,
	XAxis,
	YAxis,
} from "recharts";
import type { CostDashboardResponse } from "@/api/admin/voice-cost";
import { fetchCostDashboard, fetchUserCostBreakdown } from "@/api/admin/voice-cost";
import { queryKeys } from "@/api/query-keys";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartTooltip } from "@/components/ui/chart-tooltip";
import LoadingSkeleton from "@/components/ui/loading-skeleton";
import EmptyState from "@/components/ui/empty-state";
import StatCard from "@/components/ui/stat-card";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { useChartTheme } from "@/hooks/useChartTheme";
import { cn } from "@/utils/cn";

function BudgetProgress({
	label,
	used,
	budget,
	prefix = "¥",
}: {
	label: string;
	used: number;
	budget: number;
	prefix?: string;
}) {
	const pct = budget > 0 ? Math.min((used / budget) * 100, 100) : 0;
	const color =
		pct > 90 ? "bg-red-500" : pct > 70 ? "bg-amber-500" : "bg-emerald-500";
	const textColor =
		pct > 90 ? "text-red-600" : pct > 70 ? "text-amber-600" : "text-emerald-600";

	return (
		<div className="space-y-1">
			<div className="flex items-center justify-between text-xs">
				<span className="text-muted-foreground">{label}</span>
				<span className={cn("font-medium tabular-nums", textColor)}>
					{prefix}{used.toFixed(0)} / {prefix}{budget.toFixed(0)}
				</span>
			</div>
			<div className="h-2 w-full rounded-full bg-muted overflow-hidden">
				<div
					className={cn("h-full rounded-full transition-all duration-500", color)}
					style={{ width: `${pct}%` }}
				/>
			</div>
		</div>
	);
}

function StatGrid({ data }: { data: CostDashboardResponse }) {
	return (
		<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
			<StatCard
				icon={CircleDollarSign}
				value={`¥${data.llm_today.total_cost.toFixed(2)}`}
				label="今日 LLM 费用"
				color="blue"
			/>
			<StatCard
				icon={Volume2}
				value={`¥${data.tts_today.total_cost.toFixed(2)}`}
				label="今日 TTS 费用"
				color="teal"
			/>
			<StatCard
				icon={TrendingUp}
				value={`${data.monthly_budget > 0 ? ((data.monthly_used / data.monthly_budget) * 100).toFixed(1) : 0}%`}
				label="月度预算使用率"
				color={data.monthly_budget > 0 && data.monthly_used / data.monthly_budget > 0.9 ? "red" : "green"}
			/>
		</div>
	);
}

function CostTrendChart({ data }: { data: CostDashboardResponse }) {
	const theme = useChartTheme();
	const series = data.daily_series || [];

	if (series.length === 0) {
		return (
			<Card>
				<CardHeader>
					<CardTitle>30 天费用趋势</CardTitle>
				</CardHeader>
				<CardContent>
					<EmptyState icon={TrendingUp} title="暂无数据" />
				</CardContent>
			</Card>
		);
	}

	return (
		<Card className="h-full">
			<CardHeader>
				<CardTitle>30 天费用趋势</CardTitle>
			</CardHeader>
			<CardContent>
				<ResponsiveContainer width="100%" height={260}>
					<AreaChart data={series}>
						<defs>
							<linearGradient id="llmFill" x1="0" y1="0" x2="0" y2="1">
								<stop offset="5%" stopColor="#3b82f6" stopOpacity={0.15} />
								<stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
							</linearGradient>
							<linearGradient id="ttsFill" x1="0" y1="0" x2="0" y2="1">
								<stop offset="5%" stopColor="#14b8a6" stopOpacity={0.15} />
								<stop offset="95%" stopColor="#14b8a6" stopOpacity={0} />
							</linearGradient>
						</defs>
						<CartesianGrid strokeDasharray="3 3" stroke={theme.grid} vertical={false} />
						<XAxis
							dataKey="date"
							tick={{ fontSize: 11, fill: theme.axisTick }}
							tickLine={false}
							axisLine={false}
							interval="preserveStartEnd"
						/>
						<YAxis
							tick={{ fontSize: 11, fill: theme.axisTick }}
							tickLine={false}
							axisLine={false}
							tickFormatter={(v: number) => `¥${v.toFixed(0)}`}
							width={50}
						/>
						<Tooltip content={<ChartTooltip unit="元" />} />
						<Area
							type="monotone"
							dataKey="llm_cost"
							name="LLM"
							stroke="#3b82f6"
							strokeWidth={2}
							fill="url(#llmFill)"
							dot={false}
							activeDot={{ r: 4, strokeWidth: 0 }}
						/>
						<Area
							type="monotone"
							dataKey="tts_cost"
							name="TTS"
							stroke="#14b8a6"
							strokeWidth={2}
							fill="url(#ttsFill)"
							dot={false}
							activeDot={{ r: 4, strokeWidth: 0 }}
						/>
					</AreaChart>
				</ResponsiveContainer>
			</CardContent>
		</Card>
	);
}

function MonthlyBudgetCard({ data }: { data: CostDashboardResponse }) {
	const pct = data.monthly_budget > 0
		? Math.min((data.monthly_used / data.monthly_budget) * 100, 100)
		: 0;

	return (
		<Card className="h-full">
			<CardHeader>
				<CardTitle>月度预算</CardTitle>
			</CardHeader>
			<CardContent className="flex flex-col justify-center gap-4">
				<div className="flex items-baseline gap-1">
					<span className="text-3xl font-bold tabular-nums">
						{pct.toFixed(1)}
					</span>
					<span className="text-base text-muted-foreground">%</span>
					<span className="ml-auto text-sm text-muted-foreground">
						已用 ¥{data.monthly_used.toFixed(0)} / ¥{data.monthly_budget.toFixed(0)}
					</span>
				</div>

				<div className="h-3 w-full rounded-full bg-muted overflow-hidden">
					<div
						className={cn(
							"h-full rounded-full transition-all duration-700",
							pct > 90 ? "bg-red-500" : pct > 70 ? "bg-amber-500" : "bg-emerald-500",
						)}
						style={{ width: `${Math.max(pct, 2)}%` }}
					/>
				</div>

				<div className="space-y-2.5 pt-1">
					{data.llm_monthly_budget > 0 && (
						<BudgetProgress
							label="LLM 预算"
							used={data.llm_today.total_cost * 30}
							budget={data.llm_monthly_budget}
						/>
					)}
					{data.voice_monthly_budget > 0 && (
						<BudgetProgress
							label="语音服务预算"
			used={data.tts_today.total_cost * 30}
							budget={data.voice_monthly_budget}
						/>
					)}
				</div>
			</CardContent>
		</Card>
	);
}

function TopUsersTable({ data }: { data: CostDashboardResponse }) {
	const users = data.top_users || [];

	return (
		<Card>
			<CardHeader className="flex flex-row items-center justify-between">
				<CardTitle>费用排行 Top 10</CardTitle>
				{users.length > 0 && (
					<span className="text-xs text-muted-foreground">
						{users.length} 位用户
					</span>
				)}
			</CardHeader>
			<CardContent>
				{users.length === 0 ? (
					<EmptyState icon={Users} title="暂无数据" />
				) : (
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead className="w-12">#</TableHead>
								<TableHead>用户</TableHead>
								<TableHead className="text-right">调用次数</TableHead>
								<TableHead className="text-right">总费用</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{users.map((u, i) => (
								<TableRow key={i}>
									<TableCell className="text-muted-foreground text-xs">
										{i + 1}
									</TableCell>
									<TableCell className="font-medium">
										{u.user_name}
									</TableCell>
									<TableCell className="text-right tabular-nums">
										{u.calls}
									</TableCell>
									<TableCell className="text-right tabular-nums font-medium">
										¥{u.total_cost.toFixed(2)}
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				)}
			</CardContent>
		</Card>
	);
}

function UserCostBreakdown() {
	const { data, isLoading } = useQuery({
		queryKey: queryKeys.cost.users,
		queryFn: () => fetchUserCostBreakdown().then((r) => r.data),
		staleTime: 2 * 60_000,
	});
	const items = (data?.items || []) as { user_id: number; user_name: string; total_cost: number; total_calls: number; purposes: Record<string, { calls: number; cost: number }> }[];
	const purposeLabels: Record<string, string> = { patient_chat: "患者对话", scoring: "评分", scoring_feedback: "评分反馈", qa: "护理问答", case_generation: "病例生成", json: "结构化提取" };
	if (items.length === 0 && !isLoading) return null;
	return (
		<Card>
			<CardHeader className="flex flex-row items-center justify-between">
				<CardTitle>用户 LLM 消费明细（本月）</CardTitle>
				<span className="text-xs text-muted-foreground">{items.length} 位用户</span>
			</CardHeader>
			<CardContent>
				{isLoading ? <div className="text-sm text-muted-foreground text-center py-4">加载中…</div> : (
					<div className="space-y-2">
						{items.map((u) => (
							<div key={u.user_id} className="rounded-lg border border-border p-2.5">
								<div className="flex items-center justify-between mb-1">
									<span className="text-sm font-semibold">{u.user_name}</span>
									<span className="text-sm font-bold tabular-nums text-primary">¥{u.total_cost.toFixed(2)} <span className="text-xs text-muted-foreground font-normal">{u.total_calls}次</span></span>
								</div>
								<div className="flex flex-wrap gap-1.5">
									{Object.entries(u.purposes).map(([p, d]) => (
										<span key={p} className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{purposeLabels[p] || p}: {d.calls}次 ¥{d.cost.toFixed(2)}</span>
									))}
								</div>
							</div>
						))}
					</div>
				)}
			</CardContent>
		</Card>
	);
}

export default function CostDashboard() {
	const { data, isLoading } = useQuery({
		queryKey: queryKeys.cost.dashboard,
		queryFn: () => fetchCostDashboard().then((r) => r.data),
		staleTime: 60_000,
	});

	if (isLoading) return <LoadingSkeleton />;

	const empty: CostDashboardResponse = {
		today: { calls: 0, success: 0, error: 0, latency_ms_avg: 0, total_cost: 0 },
		this_month: {
			calls: 0,
			success: 0,
			error: 0,
			latency_ms_avg: 0,
			total_cost: 0,
		},
		llm_today: { calls: 0, success: 0, error: 0, latency_ms_avg: 0, total_cost: 0 },
		tts_today: { calls: 0, success: 0, error: 0, latency_ms_avg: 0, total_cost: 0 },
		monthly_budget: 0,
		monthly_used: 0,
		llm_monthly_budget: 0,
		voice_monthly_budget: 0,
		daily_series: [],
		top_users: [],
	};
	const d = data || empty;

	return (
		<div className="space-y-6 mt-4">
			<StatGrid data={d} />

			<div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
				<div className="lg:col-span-2">
					<CostTrendChart data={d} />
				</div>
				<MonthlyBudgetCard data={d} />
			</div>

			<TopUsersTable data={d} />
			<UserCostBreakdown />
		</div>
	);
}
