import { Badge, Button, Group, SimpleGrid, Stack, Text } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import {
	IconActivity,
	IconClock,
	IconFileText,
	IconMedal,
	IconTarget,
	IconTrendingUp,
	IconUser,
} from "@tabler/icons-react";
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
import { queryKeys } from "@/api/query-keys";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { ChartTooltip } from "@/components/ui/chart-tooltip";
import PageHeader from "@/components/ui/page-header";
import StatCard from "@/components/ui/stat-card";
import { Table } from "@mantine/core";
import { useBarColors, useChartTheme } from "@/hooks/useChartTheme";


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
		return <Text ta="center" py={48} c="dimmed">加载中...</Text>;
	}
	if (isError) {
		return <Text ta="center" py={48} c="red">加载失败：{(error as Error)?.message}</Text>;
	}
	if (!student) {
		return <Text ta="center" py={48} c="dimmed">未找到用户</Text>;
	}

	const daily = asDailyItems(student.daily);
	const hasChartData = daily.length > 0;
	const recentRecords = asRecentRecords(student.recent_records);

	return (
		<Stack gap="lg">
			<PageHeader
				title={student.display_name}
				subtitle={`学生详情 · 学号: ${student.student_id || "-"} · 注册: ${new Date(student.created_at).toLocaleDateString("zh-CN")}`}
				icon={IconUser}
				backTo="/admin/users"
			/>

			<SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }} spacing="sm" mb="xl">
				<StatCard icon={IconActivity} value={student.total_sessions} label="总训练次数" color="blue" />
				<StatCard icon={IconClock} value={student.total_minutes} label="总训练时长（分钟）" color="amber" />
				<StatCard icon={IconTarget} value={student.avg_score != null ? `${student.avg_score}分` : "-"} label="平均得分" color="green" />
				<StatCard
					icon={IconMedal}
					value={student.total_sessions > 0 ? `${Math.round(student.total_minutes / student.total_sessions)}分钟` : "-"}
					label="平均每次训练时长"
					color="blue"
				/>
			</SimpleGrid>

			{hasChartData && (
				<Stack gap="md" mb="lg">
					<Group gap={8}>
						<IconTrendingUp size={18} />
						<Text fw={600}>近30天训练趋势</Text>
					</Group>
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
				</Stack>
			)}

			<Card>
				<CardHeader>
					<Group gap={8} align="center">
						<IconFileText size={18} />
						<Text size="sm" fw={600}>最近训练记录 ({recentRecords.length}条)</Text>
					</Group>
				</CardHeader>
				<CardContent>
					<div style={{ overflowX: "auto" }}>
						<Table>
							<Table.Thead>
								<Table.Tr>
									<Table.Th>病例</Table.Th>
									<Table.Th>状态</Table.Th>
									<Table.Th>得分</Table.Th>
									<Table.Th>开始时间</Table.Th>
									<Table.Th>操作</Table.Th>
								</Table.Tr>
							</Table.Thead>
							<Table.Tbody>
								{recentRecords.map((r) => (
									<Table.Tr key={r.id}>
										<Table.Td>{r.case_name}</Table.Td>
										<Table.Td>
											<Badge variant="light" color={r.status === "completed" ? "green" : "blue"}>
												{r.status === "completed" ? "已完成" : "进行中"}
											</Badge>
										</Table.Td>
										<Table.Td style={{ fontWeight: 600, color: r.score_total != null ? "var(--mantine-color-blue-6)" : "var(--mantine-color-dimmed)" }}>
											{r.score_total != null ? `${r.score_total}分` : "未评分"}
										</Table.Td>
										<Table.Td style={{ color: "var(--mantine-color-dimmed)" }}>
											{new Date(r.start_time).toLocaleString("zh-CN")}
										</Table.Td>
										<Table.Td>
											<Button
												variant="subtle" color="gray"
												size="sm"
												onClick={() => navigate(`/record/${r.id}`)}
											>
												查看详情
											</Button>
										</Table.Td>
									</Table.Tr>
								))}
							</Table.Tbody>
						</Table>
					</div>
				</CardContent>
			</Card>
		</Stack>
	);
}
