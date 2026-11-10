import { Group, Table, Text } from "@mantine/core";
import { IconChartBar, IconClipboardList } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import { Bar, ComposedChart, Legend, ResponsiveContainer, Tooltip } from "recharts";
import type { components } from "@/api/api-types.gen";
import { queryKeys } from "@/api/query-keys";
import { getTeacherSummary, getTrends } from "@/api/stats";
import { TrainingTrendChart, TrendAxes } from "@/components/admin/TrainingTrendChart";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartTooltip } from "@/components/ui/chart-tooltip";
import EmptyState from "@/components/ui/empty-state";
import Pagination from "@/components/ui/pagination";
import TableScroll from "@/components/ui/table-scroll";
import { useBarColors } from "@/hooks/useChartTheme";

type TeacherSummaryItem = components["schemas"]["TeacherSummaryItem"];

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

const SUMMARY_LIMIT = 50;

/**
 * 全站训练趋势（按日）+ 学生训练量。
 *
 * 这两块原先在孤儿页面 `/admin/stats`（无导航入口），2026-09-30 审计后并入教学看板。
 * **窗口由看板给出**（`dateFrom`）：同一个 scope 同时喂给 KPI 数字、下钻链接和这两张图，
 * 所以"图上的窗口"与"数字的窗口"不可能分叉。
 * 周期选择器在看板头部（它同时决定 KPI 作用域），这里因此是受控的、不再持有周期状态。
 * 排名表没有搬过来 —— `/admin/scoreboard` 是它的超集。
 */
export function TrainingTrend({ dateFrom, classId }: { dateFrom?: string; classId?: number | null }) {
	const [summaryOffset, setSummaryOffset] = useState(0);

	const { data: trends } = useQuery({
		queryKey: queryKeys.stats.trends(dateFrom, classId),
		queryFn: () => getTrends(dateFrom, classId).then((r) => r.data),
		staleTime: 2 * 60_000,
	});

	const { data: summaryData } = useQuery({
		queryKey: queryKeys.stats.teacherSummary({ offset: summaryOffset, class_id: classId ?? undefined }),
		queryFn: () =>
			getTeacherSummary({ offset: summaryOffset, limit: SUMMARY_LIMIT, ...(classId ? { class_id: classId } : {}) }).then(
				(r) => r.data,
			),
		staleTime: 2 * 60_000,
	});

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
	const barColors = useBarColors();

	// 后端 teacher_summary 是 outerjoin：从没训练过的学生也在表里（次数/时长均为 0），
	// 所以这里不能按 "有训练量" 过滤 —— 那正是这张表比排名表多出来的信息。
	const summary: TeacherSummaryItem[] = summaryData?.items ?? [];
	const summaryTotal = summaryData?.total ?? 0;

	return (
		<>
			<Card>
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
								<TrendAxes rightLabel="分钟" />
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

			<Card>
				<CardHeader style={{ paddingBottom: 8 }}>
					<CardTitle>训练效果：次数与得分</CardTitle>
				</CardHeader>
				<CardContent>
					{hasData ? (
						<TrainingTrendChart data={daily} scoreDomain={[0, 60]} />
					) : (
						<EmptyState icon={IconChartBar} title="暂无该时间段的数据" />
					)}
				</CardContent>
			</Card>

			{summary.length > 0 && (
				<Card>
					<CardHeader style={{ paddingBottom: 8 }}>
						<Group gap={8} align="center">
							<IconClipboardList size={18} />
							<CardTitle>学生训练量</CardTitle>
						</Group>
					</CardHeader>
					<TableScroll minWidth={480} maxHeight={384}>
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
										<Table.Td><Text component={Link} to={`/admin/students/${s.user_id}`} size="sm" fw={500} c="brand">{s.display_name}</Text></Table.Td>
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
					</TableScroll>
					<CardContent>
						<Pagination
							total={summaryTotal}
							offset={summaryOffset}
							limit={SUMMARY_LIMIT}
							onChange={setSummaryOffset}
						/>
					</CardContent>
				</Card>
			)}
		</>
	);
}
