import { useQuery } from "@tanstack/react-query";
import { Badge, Box, Group, Modal, Paper, SimpleGrid, Stack, Text } from "@mantine/core";
import {
	IconBolt,
	IconClock,
	IconMedal,
	IconTrendingUp,
	IconTrophy,
} from "@tabler/icons-react";
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

import EmptyState from "@/components/ui/empty-state";
import { ChartTooltip } from "@/components/ui/chart-tooltip";
import { useBarColors, useChartTheme } from "@/hooks/useChartTheme";

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
	up: "green",
	flat: "dimmed",
	down: "red",
};

function trendBadge(trend: string, delta: number | null | undefined) {
	const label = TREND_LABELS[trend] ?? "暂无";
	if (delta == null) {
		return <Text inherit c="dimmed">—</Text>;
	}
	const arrow = trend === "up" ? "▲" : trend === "down" ? "▼" : "•";
	return (
		<Text inherit fw={500} c={TREND_COLORS[trend] ?? "dimmed"}>
			{arrow} {delta >= 0 ? "+" : ""}
			{delta.toFixed(1)} 分
			<Text component="span" inherit opacity={0.8} ml={4}>
				({label})
			</Text>
		</Text>
	);
}

/** 分层与后端一致：good ≥ 85，medium ≥ 60，poor < 60（0-100 分制）。 */
const TIER_TEXT_COLOR: Record<string, string> = {
	good: "green",
	medium: "yellow",
	poor: "red",
	none: "dimmed",
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
		<Modal
			opened={open}
			onClose={() => onOpenChange(false)}
			title="成绩趋势"
			size={760}
			centered
			withinPortal
		>
				{isLoading ? (
					<Group h={192} justify="center" align="center">
						<Text size="sm" c="dimmed">加载中...</Text>
					</Group>
				) : !trend || trendRecords.length === 0 ? (
					<EmptyState
						title="暂无成绩记录"
						description="该学生在当前筛选范围内没有已评分的训练记录"
					/>
				) : (
					<Stack gap="lg">
						<Group justify="space-between" wrap="wrap" gap={8}>
							<Stack gap={0}>
								<Text size="lg" fw={700}>
									{trend.display_name}
									{trend.class_name && (
										<Text component="span" size="sm" fw={400} c="dimmed" ml={8}>
											{trend.class_name}
										</Text>
									)}
								</Text>
								<Text size="xs" c="dimmed">
									{trend.student_id ?? ""} · 共 {trend.training_count} 次训练 · 覆盖{" "}
									{new Set(trendRecords.map((r) => r.case_id)).size} 个病例
								</Text>
							</Stack>
							{trend.progress_delta != null && (
								<Badge variant="light" color="gray" leftSection={<IconTrendingUp size={14} />}>
									进步幅度：{trendBadge(trend.progress_trend, trend.progress_delta)}
								</Badge>
							)}
						</Group>

						<SimpleGrid cols={{ base: 2, sm: 5 }} spacing="md">
							<Paper bg="var(--mantine-color-gray-1)" p="sm" radius="md">
								<Group gap={6} wrap="nowrap">
									<IconBolt size={13} />
									<Text size="xs" c="dimmed">训练次数</Text>
								</Group>
								<Text mt={4} size="lg" fw={700}>
									{trend.training_count}
								</Text>
							</Paper>
							<Paper bg="var(--mantine-color-gray-1)" p="sm" radius="md">
								<Group gap={6} wrap="nowrap">
									<IconClock size={13} />
									<Text size="xs" c="dimmed">总用时</Text>
								</Group>
								<Text mt={4} size="lg" fw={700}>
									{formatDuration(trend.total_duration_seconds)}
								</Text>
							</Paper>
							<Paper bg="var(--mantine-color-gray-1)" p="sm" radius="md">
								<Group gap={6} wrap="nowrap">
									<IconMedal size={13} />
									<Text size="xs" c="dimmed">平均分</Text>
								</Group>
								<Text
									mt={4}
									size="lg"
									fw={700}
									c={TIER_TEXT_COLOR[tierOf(trend.avg_score)]}
								>
									{trend.avg_score ?? "-"}
								</Text>
							</Paper>
							<Paper bg="var(--mantine-color-gray-1)" p="sm" radius="md">
								<Group gap={6} wrap="nowrap">
									<IconTrophy size={13} />
									<Text size="xs" c="dimmed">最高分</Text>
								</Group>
								<Text mt={4} size="lg" fw={700}>
									{trend.best_score ?? "-"}
								</Text>
							</Paper>
							<Paper bg="var(--mantine-color-gray-1)" p="sm" radius="md">
								<Group gap={6} wrap="nowrap">
									<IconTrendingUp size={13} />
									<Text size="xs" c="dimmed">进步幅度</Text>
								</Group>
								<Box mt={4} style={{ fontSize: "var(--mantine-font-size-lg)", fontWeight: 700 }}>
									{trendBadge(trend.progress_trend, trend.progress_delta)}
								</Box>
							</Paper>
						</SimpleGrid>

						<Stack gap={4}>
							<Text size="sm" fw={500}>分数趋势</Text>
							<Box h={208} w="100%">
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
							</Box>
						</Stack>

						<Stack gap={4}>
							<Text size="sm" fw={500}>单次训练用时（分钟）</Text>
							<Box h={160} w="100%">
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
							</Box>
						</Stack>
					</Stack>
				)}
		</Modal>
	);
}
