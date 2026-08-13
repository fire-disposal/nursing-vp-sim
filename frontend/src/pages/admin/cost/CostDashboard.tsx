import { Grid, Group, Progress, SimpleGrid, Stack, Text } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { IconCoin, IconTrendingUp, IconUsers, IconVolume2 } from "@tabler/icons-react";
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
	const color = pct > 90 ? "red" : pct > 70 ? "yellow" : "green";

	return (
		<Stack gap={4}>
			<Group justify="space-between" gap={8}>
				<Text size="xs" c="dimmed">{label}</Text>
				<Text size="xs" fw={500} c={color} style={{ fontVariantNumeric: "tabular-nums" }}>
					{prefix}{used.toFixed(0)} / {prefix}{budget.toFixed(0)}
				</Text>
			</Group>
			<Progress value={pct} size="sm" radius="md" color={color} />
		</Stack>
	);
}

function StatGrid({ data }: { data: CostDashboardResponse }) {
	return (
		<SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }} spacing="md">
			<StatCard
				icon={IconCoin}
				value={`¥${data.llm_today.total_cost.toFixed(2)}`}
				label="今日 LLM 费用"
				color="blue"
			/>
			<StatCard
				icon={IconVolume2}
				value={`¥${data.tts_today.total_cost.toFixed(2)}`}
				label="今日 TTS 费用"
				color="blue"
			/>
			<StatCard
				icon={IconTrendingUp}
				value={`${data.monthly_budget > 0 ? ((data.monthly_used / data.monthly_budget) * 100).toFixed(1) : 0}%`}
				label="月度预算使用率"
				color={data.monthly_budget > 0 && data.monthly_used / data.monthly_budget > 0.9 ? "red" : "green"}
			/>
		</SimpleGrid>
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
					<EmptyState icon={IconTrendingUp} title="暂无数据" />
				</CardContent>
			</Card>
		);
	}

	return (
		<Card style={{ height: "100%" }}>
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
		<Card style={{ height: "100%" }}>
			<CardHeader>
				<CardTitle>月度预算</CardTitle>
			</CardHeader>
			<CardContent>
				<Stack gap="md" justify="center" style={{ height: "100%" }}>
					<Group align="flex-end" gap={4} wrap="nowrap">
						<Text size="2xl" fw={700} style={{ fontVariantNumeric: "tabular-nums" }}>
							{pct.toFixed(1)}
						</Text>
						<Text size="md" c="dimmed">%</Text>
						<Text size="sm" c="dimmed" style={{ marginLeft: "auto" }}>
							已用 ¥{data.monthly_used.toFixed(0)} / ¥{data.monthly_budget.toFixed(0)}
						</Text>
					</Group>

					<Progress
						value={Math.max(pct, 2)}
						size="sm"
						radius="md"
						color={pct > 90 ? "red" : pct > 70 ? "yellow" : "green"}
					/>

					<Stack gap={10} pt={4}>
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
					</Stack>
				</Stack>
			</CardContent>
		</Card>
	);
}

function TopUsersTable({ data }: { data: CostDashboardResponse }) {
	const users = data.top_users || [];

	return (
		<Card>
			<CardHeader>
				<Group justify="space-between" align="center" wrap="wrap">
					<CardTitle>费用排行 Top 10</CardTitle>
					{users.length > 0 && (
						<Text size="xs" c="dimmed">{users.length} 位用户</Text>
					)}
				</Group>
			</CardHeader>
			<CardContent>
				{users.length === 0 ? (
					<EmptyState icon={IconUsers} title="暂无数据" />
				) : (
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead style={{ width: 48 }}>#</TableHead>
								<TableHead>用户</TableHead>
								<TableHead style={{ textAlign: "right" }}>调用次数</TableHead>
								<TableHead style={{ textAlign: "right" }}>总费用</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{users.map((u, i) => (
								<TableRow key={i}>
									<TableCell style={{ color: "var(--mantine-color-dimmed)", fontSize: 12 }}>
										{i + 1}
									</TableCell>
									<TableCell style={{ fontWeight: 500 }}>
										{u.user_name}
									</TableCell>
									<TableCell style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
										{u.calls}
									</TableCell>
									<TableCell style={{ textAlign: "right", fontWeight: 500, fontVariantNumeric: "tabular-nums" }}>
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
			<CardHeader>
				<Group justify="space-between" align="center" wrap="wrap">
					<CardTitle>用户 LLM 消费明细（本月）</CardTitle>
					<Text size="xs" c="dimmed">{items.length} 位用户</Text>
				</Group>
			</CardHeader>
			<CardContent>
				{isLoading ? (
					<Text size="sm" c="dimmed" ta="center" py="md">加载中…</Text>
				) : (
					<Stack gap={8}>
						{items.map((u) => (
							<Stack key={u.user_id} gap={4} p={10} style={{ border: "1px solid var(--mantine-color-default-border)", borderRadius: 8 }}>
								<Group justify="space-between" align="center" wrap="wrap">
									<Text size="sm" fw={600}>{u.user_name}</Text>
									<Text size="sm" fw={700} c="blue" style={{ fontVariantNumeric: "tabular-nums" }}>
										¥{u.total_cost.toFixed(2)}{" "}
										<Text component="span" size="xs" c="dimmed" fw={400} inherit>
											{u.total_calls}次
										</Text>
									</Text>
								</Group>
								<Group gap={6} wrap="wrap">
									{Object.entries(u.purposes).map(([p, d]) => (
										<Text key={p} size="xs" c="dimmed" bg="var(--mantine-color-gray-1)" px={6} py={2} style={{ borderRadius: 4 }}>
											{purposeLabels[p] || p}: {d.calls}次 ¥{d.cost.toFixed(2)}
										</Text>
									))}
								</Group>
							</Stack>
						))}
					</Stack>
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
		<Stack gap="xl" mt="md">
			<StatGrid data={d} />

			<Grid gap="md">
				<Grid.Col span={{ base: 12, lg: 8 }}>
					<CostTrendChart data={d} />
				</Grid.Col>
				<Grid.Col span={{ base: 12, lg: 4 }}>
					<MonthlyBudgetCard data={d} />
				</Grid.Col>
			</Grid>

			<TopUsersTable data={d} />
			<UserCostBreakdown />
		</Stack>
	);
}
