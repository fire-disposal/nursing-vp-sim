import { Alert, Badge, Box, Group, Paper, SimpleGrid, Stack, Text } from "@mantine/core";
import {
	IconBolt,
	IconClock,
	IconInfoCircle,
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
import { ChartTooltip } from "@/components/ui/chart-tooltip";
import EmptyState from "@/components/ui/empty-state";
import { useBarColors, useChartTheme } from "@/hooks/useChartTheme";
import { formatDuration } from "@/utils/duration";
import {
	capabilityNotice,
	toComparability,
	toGradePolicy,
} from "@/utils/grade-bands";

type StudentTrendResponse = components["schemas"]["StudentTrendResponse"];

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

/**
 * 学生成绩趋势的**只读视图** —— 排行弹窗与学习档案共用同一份渲染。
 *
 * 所有判断都在服务端：数值分层与能力等第来自趋势响应的 `policy` 块，跨可比组时
 * 服务端不返回 `progress_delta/progress_trend`，这里也就**不**下「进步/退步」结论。
 * 组件不自己拉数据，数据由调用方查询后传进来 —— 同一组筛选条件在弹窗与档案页必须
 * 命中同一份缓存与同一套口径。
 */
export default function StudentTrendView({ trend }: { trend: StudentTrendResponse | null | undefined }) {
	const chartTheme = useChartTheme();
	const barColors = useBarColors();

	const trendRecords = trend?.records ?? [];
	const policy = toGradePolicy(trend?.policy);
	const capability = capabilityNotice(policy);
	const comparability = toComparability(trend?.comparability);
	// single_group=false：记录跨可比组 → 不展示跨组「进步/退步」结论（服务端此时不给 delta）
	const crossGroup = comparability != null && !comparability.singleGroup;
	const chartData = trendRecords.map((r, i) => ({
		name: `第${i + 1}次`,
		label: `第${i + 1}次 · ${r.case_name || `病例#${r.case_id}`}${r.comparability_label ? ` · ${r.comparability_label}` : ""}`,
		score: r.score,
		minutes: Math.round(r.duration_seconds / 60),
		assignment: r.assignment_title ?? "自主训练",
	}));

	if (!trend || trendRecords.length === 0) {
		return (
			<EmptyState
				title="暂无成绩记录"
				description="该学生还没有已评分的训练记录"
			/>
		);
	}

	return (
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
				{!crossGroup && trend.progress_delta != null && (
					<Badge variant="light" color="gray" leftSection={<IconTrendingUp size={14} />}>
						进步幅度：{trendBadge(trend.progress_trend, trend.progress_delta)}
					</Badge>
				)}
			</Group>

			{crossGroup && (
				<Alert
					variant="light"
					color="yellow"
					icon={<IconInfoCircle size={16} />}
					title="记录跨可比组，未计算进步幅度"
				>
					<Text size="xs">
						不同任务/量尺/辅助条件的记录不构成可比组，前后均分之差不作为「进步/退步」结论（服务端此时不返回该值）。
					</Text>
					{comparability.groups.length > 0 && (
						<Text size="xs" mt={4}>
							可比组：
							{comparability.groups.map((g) => `${g.label}（${g.count} 条）`).join("；")}
						</Text>
					)}
				</Alert>
			)}

			{capability && (
				<Text size="xs" c="dimmed">
					{capability.label}
					{capability.note ? `：${capability.note}` : ""}
				</Text>
			)}

			<SimpleGrid cols={{ base: 2, sm: 3, lg: 5 }} spacing="md">
				<Paper bg="var(--mantine-color-default-hover)" p="sm">
					<Group gap={6} wrap="nowrap">
						<IconBolt size={13} />
						<Text size="xs" c="dimmed">训练次数</Text>
					</Group>
					<Text mt={4} size="lg" fw={700}>
						{trend.training_count}
					</Text>
				</Paper>
				<Paper bg="var(--mantine-color-default-hover)" p="sm">
					<Group gap={6} wrap="nowrap">
						<IconClock size={13} />
						<Text size="xs" c="dimmed">总用时</Text>
					</Group>
					<Text mt={4} size="lg" fw={700}>
						{formatDuration(trend.total_duration_seconds)}
					</Text>
				</Paper>
				<Paper bg="var(--mantine-color-default-hover)" p="sm">
					<Group gap={6} wrap="nowrap">
						<IconMedal size={13} />
						<Text size="xs" c="dimmed">平均分（数值参考）</Text>
					</Group>
					<Text mt={4} size="lg" fw={700} title="数值参考，不代表能力等第">
						{trend.avg_score ?? "-"}
					</Text>
				</Paper>
				<Paper bg="var(--mantine-color-default-hover)" p="sm">
					<Group gap={6} wrap="nowrap">
						<IconTrophy size={13} />
						<Text size="xs" c="dimmed">最高分</Text>
					</Group>
					<Text mt={4} size="lg" fw={700}>
						{trend.best_score ?? "-"}
					</Text>
				</Paper>
				<Paper bg="var(--mantine-color-default-hover)" p="sm">
					<Group gap={6} wrap="nowrap">
						<IconTrendingUp size={13} />
						<Text size="xs" c="dimmed">进步幅度</Text>
					</Group>
					<Box mt={4} style={{ fontSize: "var(--mantine-font-size-lg)", fontWeight: 700 }}>
						{crossGroup ? (
							<Text inherit size="sm" c="dimmed">
								跨可比组，不计算
							</Text>
						) : (
							trendBadge(trend.progress_trend, trend.progress_delta)
						)}
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
								labelFormatter={(label, payload) => payload?.[0]?.payload?.label ?? label}
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
									`${payload?.[0]?.payload?.label ?? label} · ${payload?.[0]?.payload?.assignment ?? ""}`
								}
								cursor={{ fill: "var(--border)", opacity: 0.4 }}
							/>
							<Bar dataKey="minutes" name="用时" fill={barColors.minutes} radius={[4, 4, 0, 0]} />
						</BarChart>
					</ResponsiveContainer>
				</Box>
			</Stack>
		</Stack>
	);
}
