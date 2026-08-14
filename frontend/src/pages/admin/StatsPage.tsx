import { Group, SegmentedControl, SimpleGrid, Table, Text } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import {
	IconActivity,
	IconChartBar,
	IconClipboardList,
	IconClock,
	IconMedal,
	IconTarget,
	IconTrendingUp,
	IconTrophy,
} from "@tabler/icons-react";
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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartTooltip } from "@/components/ui/chart-tooltip";
import EmptyState from "@/components/ui/empty-state";
import RecordSubPageLayout from "@/components/shell/RecordSubPageLayout";
import Pagination from "@/components/ui/pagination";
import StatCard from "@/components/ui/stat-card";
import { useBarColors, useChartTheme } from "@/hooks/useChartTheme";
import useAuthStore from "@/stores/authStore";
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
	hasTeacherView: boolean;
	LIMIT?: number;
}

function Stats() {
	const [period, setPeriod] = useState("month");
	const [summaryOffset, setSummaryOffset] = useState(0);
	const [rankingOffset, setRankingOffset] = useState(0);
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
			hasTeacherView={hasTeacherView}
		/>
	);
}

export default function StatsPage() {
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
		<RecordSubPageLayout
			title="训练统计"
			subtitle={hasTeacherView ? "查看所有学生的训练趋势、时长和得分统计" : "查看你的训练投入与效果趋势"}
			icon={IconChartBar}
		>
			{trends && (
				<SimpleGrid cols={{ base: 2, sm: 4 }} spacing="md" mb="xl">
					<StatCard
						icon={IconActivity}
						value={trends.total_sessions}
						label="总训练次数"
						color="blue"
					/>
					<StatCard
						icon={IconClock}
						value={trends.total_minutes}
						label="总训练时长（分钟）"
						color="amber"
					/>
					<StatCard
						icon={IconTarget}
						value={trends.avg_score != null ? `${trends.avg_score}分` : "-"}
						label="平均得分"
						color="green"
					/>
					<StatCard
						icon={IconTrendingUp}
						value={
							trends.total_sessions > 0
								? `${Math.round(trends.total_minutes / trends.total_sessions)}分钟`
								: "-"
						}
						label="平均每次训练时长"
						color="blue"
					/>
				</SimpleGrid>
			)}

			<Group justify="flex-end" mb="xl">
				<SegmentedControl
					data={[
						{ value: "week", label: "近7天" },
						{ value: "month", label: "近30天" },
						{ value: "all", label: "全部" },
					]}
					value={period}
					onChange={setPeriod}
				/>
			</Group>

			<Card mb="xl">
				<CardHeader style={{ paddingBottom: 8 }}>
					<CardTitle>训练投入：次数与时长</CardTitle>
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
						<EmptyState icon={IconChartBar} title="暂无该时间段的数据" />
					)}
				</CardContent>
			</Card>

			<Card mb="xl">
				<CardHeader style={{ paddingBottom: 8 }}>
					<CardTitle>训练效果：次数与得分</CardTitle>
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
						<EmptyState icon={IconChartBar} title="暂无该时间段的数据" />
					)}
				</CardContent>
			</Card>

			{hasTeacherView && summary && summary.length > 0 && (
				<Card mb="xl">
					<CardHeader style={{ paddingBottom: 8 }}>
						<Group gap={8} align="center">
							<IconClipboardList size={18} />
							<CardTitle>学生训练统计</CardTitle>
						</Group>
					</CardHeader>
					<div style={{ maxHeight: 384, overflow: "auto" }}>
						<Table>
							<Table.Thead>
								<Table.Tr>
									<Table.Th>学生</Table.Th>
									<Table.Th>学号</Table.Th>
									<Table.Th>训练次数</Table.Th>
									<Table.Th>总时长（分钟）</Table.Th>
									<Table.Th>平均时长</Table.Th>
								</Table.Tr>
							</Table.Thead>
							<Table.Tbody>
								{summary.map((s) => (
									<Table.Tr key={s.user_id}>
										<Table.Td>{s.display_name}</Table.Td>
										<Table.Td style={{ color: "var(--mantine-color-dimmed)" }}>{s.student_code}</Table.Td>
										<Table.Td>{s.total_sessions}</Table.Td>
										<Table.Td style={{ fontWeight: 600 }}>{s.total_minutes}</Table.Td>
										<Table.Td style={{ color: "var(--mantine-color-dimmed)" }}>
											{s.total_sessions > 0
												? `${Math.round(s.total_minutes / s.total_sessions)}分钟`
												: "-"}
										</Table.Td>
									</Table.Tr>
								))}
							</Table.Tbody>
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
					<CardHeader style={{ paddingBottom: 8 }}>
						<Group justify="space-between" align="center" wrap="wrap">
							<Group gap={8} align="center">
								<IconTrophy size={18} color="var(--mantine-color-yellow-6)" />
								<CardTitle>学生成绩排名</CardTitle>
							</Group>
							<Text size="xs" c="dimmed">按平均分降序</Text>
						</Group>
					</CardHeader>
					<div style={{ maxHeight: 384, overflow: "auto" }}>
						<Table>
							<Table.Thead>
								<Table.Tr>
									<Table.Th style={{ width: 60 }}>排名</Table.Th>
									<Table.Th>学生</Table.Th>
									<Table.Th>学号</Table.Th>
									<Table.Th>训练次数</Table.Th>
									<Table.Th>平均分</Table.Th>
									<Table.Th>总分</Table.Th>
									<Table.Th>总时长</Table.Th>
								</Table.Tr>
							</Table.Thead>
							<Table.Tbody>
								{ranking.map((s) => (
									<Table.Tr key={s.user_id} style={s.rank <= 3 ? { background: "var(--mantine-color-yellow-0)" } : undefined}>
										<Table.Td>
											{s.rank === 1 ? (
												<IconMedal size={20} color="var(--mantine-color-yellow-6)" />
											) : s.rank === 2 ? (
												<IconMedal size={20} color="var(--mantine-color-gray-5)" />
											) : s.rank === 3 ? (
												<IconMedal size={20} color="var(--mantine-color-orange-7)" />
											) : (
												<Text component="span" c="dimmed" fw={600}>{s.rank}</Text>
											)}
										</Table.Td>
										<Table.Td style={{ fontWeight: 500 }}>{s.display_name}</Table.Td>
										<Table.Td style={{ color: "var(--mantine-color-dimmed)" }}>{s.student_id || "-"}</Table.Td>
										<Table.Td>{s.total_sessions}</Table.Td>
										<Table.Td style={{ fontWeight: 700, color: s.avg_score != null ? "var(--mantine-color-blue-6)" : "var(--mantine-color-dimmed)" }}>
											{s.avg_score != null ? `${s.avg_score}分` : "-"}
										</Table.Td>
										<Table.Td style={{ color: "var(--mantine-color-dimmed)" }}>
											{s.total_score > 0 ? `${s.total_score}分` : "-"}
										</Table.Td>
										<Table.Td style={{ color: "var(--mantine-color-dimmed)" }}>{s.total_minutes}分钟</Table.Td>
									</Table.Tr>
								))}
							</Table.Tbody>
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
		</RecordSubPageLayout>
	);
}
