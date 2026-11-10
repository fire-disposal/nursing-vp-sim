import {
	Anchor,
	Badge,
	Button,
	Group,
	Paper,
	SimpleGrid,
	Stack,
	Table,
	Text,
	Title,
} from "@mantine/core";
import {
	IconActivity,
	IconAlertTriangle,
	IconArrowRight,
	IconBuildingCommunity,
	IconCoins,
	IconRefresh,
	IconSchool,
	IconUsers,
} from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import { fetchDiagnose } from "@/api/admin/ops";
import { getSchools } from "@/api/admin/schools";
import { fetchCostDashboard } from "@/api/admin/voice-cost";
import { queryKeys } from "@/api/query-keys";
import EmptyState from "@/components/ui/empty-state";
import ErrorState from "@/components/ui/error-state";
import LoadingSkeleton from "@/components/ui/loading-skeleton";
import PageHeader from "@/components/ui/page-header";
import StatCard from "@/components/ui/stat-card";
import TableScroll from "@/components/ui/table-scroll";

const number = (value: number | null | undefined) =>
	(value ?? 0).toLocaleString("zh-CN");

const money = (value: number | null | undefined) =>
	`¥${(value ?? 0).toLocaleString("zh-CN", {
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
	})}`;

export default function PlatformOverviewPage() {
	const navigate = useNavigate();
	const schoolsQuery = useQuery({
		queryKey: queryKeys.schools.all,
		queryFn: () => getSchools().then((r) => r.data),
		staleTime: 60_000,
	});
	const diagnoseQuery = useQuery({
		queryKey: queryKeys.diagnose,
		queryFn: () => fetchDiagnose().then((r) => r.data),
		staleTime: 30_000,
	});
	const costQuery = useQuery({
		queryKey: queryKeys.cost.dashboard,
		queryFn: () => fetchCostDashboard().then((r) => r.data),
		staleTime: 60_000,
	});

	const schools = schoolsQuery.data ?? [];
	const totals = useMemo(
		() =>
			schools.reduce(
				(acc, school) => ({
					classes: acc.classes + school.class_count,
					users: acc.users + school.user_count,
					admins: acc.admins + school.admin_count,
				}),
				{ classes: 0, users: 0, admins: 0 },
			),
		[schools],
	);
	const diagnose = diagnoseQuery.data;
	const cost = costQuery.data;
	const alerts = diagnose?.alerts.length ?? 0;
	const llmSuccess = diagnose?.llm.success_rate;
	const unanswered = diagnose?.feedback?.unanswered;
	const costValue = costQuery.isLoading
		? "…"
		: costQuery.isError || !cost
			? "—"
			: money(cost.this_month.total_cost);
	const refreshAll = () => {
		void Promise.all([
			schoolsQuery.refetch(),
			diagnoseQuery.refetch(),
			costQuery.refetch(),
		]);
	};

	const actions = (
		<Group gap="xs">
			<Button variant="default" size="compact-sm" loading={schoolsQuery.isFetching} onClick={refreshAll}>
				<IconRefresh size={15} />
				刷新
			</Button>
			<Button component={Link} to="/admin/schools" size="compact-sm">
				院校管理
				<IconArrowRight size={15} />
			</Button>
		</Group>
	);

	return (
		<Stack gap="lg">
			<PageHeader
				title="平台总览"
				subtitle="跨院校的规模、运行状态与本月资源使用"
				icon={IconBuildingCommunity}
				actions={actions}
			/>

			{schoolsQuery.isLoading ? (
				<LoadingSkeleton variant="stats" />
			) : schoolsQuery.isError ? (
				<ErrorState
					title="平台数据加载失败"
					error={schoolsQuery.error}
					onRetry={() => void schoolsQuery.refetch()}
				/>
			) : (
				<>
					<SimpleGrid cols={{ base: 1, sm: 2, xl: 4 }} spacing="md">
						<StatCard
							icon={IconBuildingCommunity}
							value={number(schools.length)}
							label="院校"
							color="blue"
							onClick={() => navigate("/admin/schools")}
						/>
						<StatCard
							icon={IconUsers}
							value={number(totals.users)}
							label="院校账号"
							color="green"
						/>
						<StatCard
							icon={IconSchool}
							value={number(totals.classes)}
							label="班级"
							color="amber"
						/>
						<StatCard
							icon={IconCoins}
							value={costValue}
							label="本月 LLM + TTS 成本"
							color="blue"
							onClick={() => navigate("/admin/costs")}
						/>
					</SimpleGrid>

					<SimpleGrid cols={{ base: 1, lg: 2 }} spacing="md">
						<Paper withBorder p="lg" radius="md">
							<Group justify="space-between" align="flex-start" mb="md">
								<div>
									<Text fw={600}>运行与今日</Text>
									<Text size="xs" c="dimmed" mt={2}>
										数据来自全局诊断与业务计数
									</Text>
								</div>
								<Badge
									variant="light"
									color={
										diagnoseQuery.isLoading || diagnoseQuery.isError
											? "gray"
											: alerts > 0
												? "red"
												: "green"
									}
									leftSection={
										alerts > 0 ? <IconAlertTriangle size={12} /> : <IconActivity size={12} />
									}
								>
									{diagnoseQuery.isLoading
										? "加载中"
										: diagnoseQuery.isError
											? "状态未知"
											: alerts > 0
												? `${alerts} 项告警`
												: "运行正常"}
								</Badge>
							</Group>
							{diagnoseQuery.isLoading ? (
								<LoadingSkeleton variant="text" message="加载运行数据…" />
							) : diagnoseQuery.isError ? (
								<Text size="sm" c="dimmed">
									诊断数据暂不可用。
								</Text>
							) : (
								<Stack gap="xs">
									<MetricRow
										label="LLM 调用（24h）"
										value={
											diagnose
												? `${number(diagnose.llm.total_calls_24h)} 次 · 成功率 ${diagnose.llm.success_rate}%`
												: "—"
										}
									/>
									<MetricRow
										label="今日活跃账号"
										value={diagnose ? number(diagnose.business.today_users) : "—"}
									/>
									<MetricRow
										label="今日训练"
										value={
											diagnose
												? `${number(diagnose.business.today_trainings)} 次 · 完成 ${number(diagnose.business.today_completed)}`
												: "—"
										}
									/>
									<MetricRow
										label="进行中训练"
										value={diagnose ? number(Number(diagnose.metrics.active_sessions ?? 0)) : "—"}
									/>
									<MetricRow
										label="未回复反馈"
										value={unanswered == null ? "—" : `${number(unanswered)} 条`}
									/>
									<MetricRow
										label="LLM 成功率"
										value={llmSuccess == null ? "—" : `${llmSuccess}%`}
									/>
								</Stack>
							)}
						</Paper>

						<Paper withBorder p="lg" radius="md">
							<Group justify="space-between" align="flex-start" mb="md">
								<div>
									<Text fw={600}>资源与入口</Text>
									<Text size="xs" c="dimmed" mt={2}>
										跨院校维护与系统治理
									</Text>
								</div>
								<IconCoins size={18} opacity={0.45} />
							</Group>
							<Stack gap="sm">
								<Anchor component={Link} to="/admin/costs" size="sm">
									成本管理
									<IconArrowRight size={13} style={{ marginLeft: 4, verticalAlign: "middle" }} />
								</Anchor>
								<Anchor component={Link} to="/admin/audit-logs" size="sm">
									审计日志
									<IconArrowRight size={13} style={{ marginLeft: 4, verticalAlign: "middle" }} />
								</Anchor>
								<Anchor component={Link} to="/admin/system-ops" size="sm">
									运维仪表盘
									<IconArrowRight size={13} style={{ marginLeft: 4, verticalAlign: "middle" }} />
								</Anchor>
							</Stack>
							{costQuery.isError && (
								<Text size="xs" c="dimmed" mt="md">
									成本数据暂不可用。
								</Text>
							)}
						</Paper>
					</SimpleGrid>

					<Paper withBorder p="lg" radius="md">
						<Group justify="space-between" align="flex-start" mb="md">
							<div>
								<Title order={2} size="h4">
									院校概览
								</Title>
								<Text size="xs" c="dimmed" mt={2}>
									账号与班级为各院校当前规模
								</Text>
							</div>
							<Button component={Link} to="/admin/schools" variant="subtle" size="compact-sm">
								全部院校
								<IconArrowRight size={14} />
							</Button>
						</Group>
						{schools.length === 0 ? (
							<EmptyState
								icon={IconBuildingCommunity}
								title="还没有院校"
								description="创建第一所院校后，平台总览会显示规模与运行数据"
							/>
						) : (
							<TableScroll minWidth={620}>
								<Table>
									<Table.Thead>
										<Table.Tr>
											<Table.Th>院校</Table.Th>
											<Table.Th>班级</Table.Th>
											<Table.Th>院校账号</Table.Th>
											<Table.Th>管理员</Table.Th>
											<Table.Th aria-label="操作" />
										</Table.Tr>
									</Table.Thead>
									<Table.Tbody>
										{schools.map((school) => (
											<Table.Tr key={school.id}>
												<Table.Td>
													<Anchor component={Link} to={`/admin/schools/${school.id}`} fw={500}>
														{school.name}
													</Anchor>
												</Table.Td>
												<Table.Td className="tabular-nums">{number(school.class_count)}</Table.Td>
												<Table.Td className="tabular-nums">{number(school.user_count)}</Table.Td>
												<Table.Td className="tabular-nums">{number(school.admin_count)}</Table.Td>
												<Table.Td ta="right">
													<Button
														component={Link}
														to={`/admin/schools/${school.id}`}
														variant="subtle"
														size="compact-xs"
													>
														查看
													</Button>
												</Table.Td>
											</Table.Tr>
										))}
									</Table.Tbody>
								</Table>
							</TableScroll>
						)}
					</Paper>
				</>
			)}
		</Stack>
	);
}

function MetricRow({ label, value }: { label: string; value: string }) {
	return (
		<Group justify="space-between" gap="md" wrap="nowrap">
			<Text size="sm" c="dimmed">
				{label}
			</Text>
			<Text size="sm" fw={500} ta="right" className="tabular-nums">
				{value}
			</Text>
		</Group>
	);
}
