import { useQuery } from "@tanstack/react-query";
import {
	CircleDollarSign,
	Mic,
	TrendingUp,
	Volume2,
} from "lucide-react";
import {
	Line,
	LineChart,
	ResponsiveContainer,
	Tooltip,
	XAxis,
	YAxis,
} from "recharts";
import { fetchCostDashboard } from "@/api/admin/voice-cost";
import type { CostDashboardResponse } from "@/api/admin/voice-cost";
import { ChartTooltip } from "@/components/ui/ChartTooltip";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import LoadingSkeleton from "@/components/ui/LoadingSkeleton";
import StatCard from "@/components/ui/StatCard";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { useChartTheme } from "@/hooks/useChartTheme";

function BudgetGauge({ used, budget }: { used: number; budget: number }) {
	const pct = budget > 0 ? Math.min((used / budget) * 100, 100) : 0;
	const radius = 40;
	const circumference = 2 * Math.PI * radius;
	const offset = circumference - (pct / 100) * circumference;
	const color =
		pct > 90 ? "#ef4444" : pct > 70 ? "#f59e0b" : "#22c55e";

	return (
		<div className="flex flex-col items-center">
			<svg width="110" height="110" viewBox="0 0 110 110">
				<title>预算使用率 {Math.round(pct)}%</title>
				<circle
					cx="55"
					cy="55"
					r={radius}
					fill="none"
					stroke="var(--border)"
					strokeWidth="8"
				/>
				<circle
					cx="55"
					cy="55"
					r={radius}
					fill="none"
					stroke={color}
					strokeWidth="8"
					strokeLinecap="round"
					strokeDasharray={circumference}
					strokeDashoffset={offset}
					transform="rotate(-90 55 55)"
					style={{ transition: "stroke-dashoffset 0.8s ease" }}
				/>
				<text
					x="55"
					y="52"
					textAnchor="middle"
					className="text-lg font-bold"
					fill="currentColor"
				>
					{pct.toFixed(0)}%
				</text>
				<text
					x="55"
					y="68"
					textAnchor="middle"
					className="text-[10px]"
					fill="var(--muted-foreground)"
				>
					已用 ¥{used.toFixed(0)} / ¥{budget.toFixed(0)}
				</text>
			</svg>
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
				icon={Mic}
				value={`¥${data.asr_today.total_cost.toFixed(2)}`}
				label="今日 ASR 费用"
				color="amber"
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
				<CardContent className="text-muted-foreground text-sm text-center py-8">
					暂无数据
				</CardContent>
			</Card>
		);
	}

	return (
		<Card>
			<CardHeader>
				<CardTitle>30 天费用趋势</CardTitle>
			</CardHeader>
			<CardContent>
				<ResponsiveContainer width="100%" height={280}>
					<LineChart data={series}>
						<XAxis
							dataKey="date"
							tick={{ fontSize: 11, fill: theme.axisTick }}
							tickLine={false}
							axisLine={{ stroke: theme.grid }}
						/>
						<YAxis
							tick={{ fontSize: 11, fill: theme.axisTick }}
							tickLine={false}
							axisLine={false}
							tickFormatter={(v: number) => `¥${v.toFixed(0)}`}
						/>
						<Tooltip
							content={<ChartTooltip unit="元" />}
						/>
						<Line
							type="monotone"
							dataKey="llm_cost"
							name="LLM"
							stroke="#3b82f6"
							strokeWidth={2}
							dot={false}
							activeDot={{ r: 4 }}
						/>
						<Line
							type="monotone"
							dataKey="tts_cost"
							name="TTS"
							stroke="#14b8a6"
							strokeWidth={2}
							dot={false}
							activeDot={{ r: 4 }}
						/>
						<Line
							type="monotone"
							dataKey="asr_cost"
							name="ASR"
							stroke="#f59e0b"
							strokeWidth={2}
							dot={false}
							activeDot={{ r: 4 }}
						/>
					</LineChart>
				</ResponsiveContainer>
			</CardContent>
		</Card>
	);
}

function TopUsersTable({ data }: { data: CostDashboardResponse }) {
	const users = data.top_users || [];

	return (
		<Card>
			<CardHeader>
				<CardTitle>费用排行 Top Users</CardTitle>
			</CardHeader>
			<CardContent>
				{users.length === 0 ? (
					<div className="text-muted-foreground text-sm text-center py-4">
						暂无数据
					</div>
				) : (
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>用户</TableHead>
								<TableHead>调用次数</TableHead>
								<TableHead className="text-right">总费用</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{users.map((u, i) => (
								<TableRow key={i}>
									<TableCell className="font-medium">
										{u.user_name}
									</TableCell>
									<TableCell>{u.calls}</TableCell>
									<TableCell className="text-right">
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

export default function CostDashboard() {
	const { data, isLoading } = useQuery({
		queryKey: ["admin", "cost", "dashboard"],
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
		asr_today: { calls: 0, success: 0, error: 0, latency_ms_avg: 0, total_cost: 0 },
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
				<Card>
					<CardHeader>
						<CardTitle>月度预算</CardTitle>
					</CardHeader>
					<CardContent className="flex justify-center">
						<BudgetGauge used={d.monthly_used} budget={d.monthly_budget} />
					</CardContent>
				</Card>
			</div>

			<TopUsersTable data={d} />
		</div>
	);
}
