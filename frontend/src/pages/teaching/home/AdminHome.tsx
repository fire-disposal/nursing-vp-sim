import { Grid, Group, Paper, Progress, SimpleGrid, Stack, Table, Text, ThemeIcon, Title } from "@mantine/core";
import {
	IconClipboardCheck,
	IconMessageCircle,
	IconSchool,
	IconShield,
	IconUserCheck,
	IconUsers,
} from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import type { ComponentType } from "react";
import { Link, useNavigate } from "react-router-dom";
import { getRecordsSummary } from "@/api";
import { getAssignments } from "@/api/assignments";
import { getPersonas } from "@/api/admin/personas";
import { queryKeys } from "@/api/query-keys";
import { getSchoolClassSummary } from "@/api/stats";
import StatCard from "@/components/ui/stat-card";
import useAuthStore from "@/stores/authStore";
import { APP_TIME_ZONE, shanghaiDateKey, shanghaiHour } from "@/utils/date";

/**
 * 院校管理员首页 = **管理概览**，不是教师看板的副本。
 *
 * 管理员日常关心"人、班、待处理"，教师关心"今天教了什么、还有什么没批"：
 * 两套首页因此分开（`Home.tsx` 二选一）。数据全部复用既有聚合端点，
 * 不新增后端口径：人数来自视角目录、班级来自 class-summary、待批阅来自 records/summary。
 */
function QuickAction({
	to,
	icon: Icon,
	label,
	hint,
}: {
	to: string;
	icon: ComponentType<{ size?: number; strokeWidth?: number }>;
	label: string;
	hint: string;
}) {
	return (
		<Paper
			component={Link}
			to={to}
			withBorder
			radius="md"
			p="sm"
			style={{ textDecoration: "none", color: "inherit" }}
		>
			<Group gap="sm" wrap="nowrap">
				<ThemeIcon size={34} radius="md" variant="light" color="brand">
					<Icon size={17} strokeWidth={1.8} />
				</ThemeIcon>
				<div style={{ minWidth: 0 }}>
					<Text size="sm" fw={500} truncate>
						{label}
					</Text>
					<Text size="xs" c="dimmed" truncate>
						{hint}
					</Text>
				</div>
			</Group>
		</Paper>
	);
}


export default function AdminHome() {
	const user = useAuthStore((s) => s.user);
	const navigate = useNavigate();
	const hour = shanghaiHour();
	const greeting = hour < 12 ? "上午好" : hour < 18 ? "下午好" : "晚上好";
	const todayFrom = `${shanghaiDateKey()}T00:00:00+08:00`;

	const presetsQuery = useQuery({
		queryKey: queryKeys.admin.personas,
		queryFn: () => getPersonas().then((r) => r.data),
		staleTime: 60_000,
	});
	const classesQuery = useQuery({
		queryKey: queryKeys.stats.classSummary(),
		queryFn: () => getSchoolClassSummary().then((r) => r.data),
		staleTime: 60_000,
	});
	const todayQuery = useQuery({
		queryKey: queryKeys.training.recordsSummary({ date_from: todayFrom }),
		queryFn: () => getRecordsSummary({ date_from: todayFrom }).then((r) => r.data),
		staleTime: 30_000,
	});
	const pendingQuery = useQuery({
		queryKey: queryKeys.training.recordsSummary({ review_status: "pending" }),
		queryFn: () => getRecordsSummary({ review_status: "pending" }).then((r) => r.data),
		staleTime: 30_000,
	});
	const assignmentsQuery = useQuery({
		queryKey: queryKeys.assignments.list({ status: "active", limit: 1 }),
		queryFn: () => getAssignments({ status: "active", limit: 1 }).then((r) => r.data),
		staleTime: 60_000,
	});

	const counts = new Map((presetsQuery.data ?? []).map((p) => [p.key, p.user_count]));
	const classes = classesQuery.data ?? [];
	const today = todayQuery.data;
	const pendingTotal = pendingQuery.data?.total ?? 0;

	return (
		<Stack gap="xl">
			<Group justify="space-between" align="flex-end" wrap="wrap">
				<div>
					<Title order={1} size="xl" fw={700}>
						{greeting}，{user?.display_name || "管理员"}
					</Title>
					<Text size="sm" c="dimmed" mt={4}>
						{new Date().toLocaleDateString("zh-CN", {
							timeZone: APP_TIME_ZONE,
							year: "numeric",
							month: "long",
							day: "numeric",
						})}
					</Text>
				</div>
				<Text size="xs" c="dimmed">
					院校管理概览
				</Text>
			</Group>

			<SimpleGrid cols={{ base: 2, sm: 4 }} spacing="sm">
				<QuickAction to="/admin/users" icon={IconUsers} label="用户管理" hint="账号、视角、额度" />
				<QuickAction to="/admin/classes" icon={IconSchool} label="班级管理" hint="分班与成员" />
				<QuickAction to="/admin/personas" icon={IconShield} label="视角管理" hint="授予与收回" />
				<QuickAction to="/admin/feedback" icon={IconMessageCircle} label="系统反馈" hint="处理问题" />
			</SimpleGrid>

			<SimpleGrid cols={{ base: 2, md: 4 }} spacing="sm">
				<StatCard
					icon={IconUsers}
					value={counts.get("student") ?? "—"}
					label="学生"
					color="blue"
					onClick={() => navigate("/admin/users?persona=student")}
				/>
				<StatCard
					icon={IconUserCheck}
					value={counts.get("teacher") ?? "—"}
					label="教师"
					color="green"
					onClick={() => navigate("/admin/users?persona=teacher")}
				/>
				<StatCard
					icon={IconSchool}
					value={classes.length}
					label="班级"
					color="amber"
					onClick={() => navigate("/admin/classes")}
				/>
				<StatCard
					icon={IconClipboardCheck}
					value={pendingTotal}
					label="待批阅训练"
					color={pendingTotal > 0 ? "red" : "green"}
					onClick={pendingTotal > 0 ? () => navigate("/admin/records?review_status=pending") : undefined}
				/>
			</SimpleGrid>

			<Grid gap="md">
				<Grid.Col span={{ base: 12, lg: 8 }}>
				<Paper withBorder radius="md" p="md">
					<Group justify="space-between" mb="sm">
						<Text size="sm" fw={600}>
							班级概览
						</Text>
						<Text size="xs" c="dimmed" component={Link} to="/admin/classes">
							全部班级
						</Text>
					</Group>
					{classes.length === 0 ? (
						<Text size="sm" c="dimmed">
							还没有班级
						</Text>
					) : (
						<Table.ScrollContainer minWidth={520}>
							<Table verticalSpacing="xs" highlightOnHover>
								<Table.Thead>
									<Table.Tr>
										<Table.Th>班级</Table.Th>
										<Table.Th>学生</Table.Th>
										<Table.Th>训练次数</Table.Th>
										<Table.Th>平均分</Table.Th>
										<Table.Th w={120}>人均训练</Table.Th>
									</Table.Tr>
								</Table.Thead>
								<Table.Tbody>
									{classes.map((cls) => (
										<Table.Tr key={cls.class_id}>
											<Table.Td>
												<Text
													size="sm"
													fw={500}
													component={Link}
													to={`/admin/classes/${cls.class_id}`}
												>
													{cls.class_name}
												</Text>
												{cls.cohort_label && (
													<Text size="xs" c="dimmed">
														{cls.cohort_label}
													</Text>
												)}
											</Table.Td>
											<Table.Td>{cls.student_count}</Table.Td>
											<Table.Td>{cls.total_sessions}</Table.Td>
											<Table.Td>{cls.avg_score ?? "—"}</Table.Td>
											<Table.Td>
												<Group gap={6} wrap="nowrap">
													<Progress
														value={Math.min(100, cls.completion_rate * 100)}
														size="sm"
														style={{ flex: 1 }}
													/>
													<Text size="xs" c="dimmed" className="tabular-nums">
														{cls.completion_rate.toFixed(1)}
													</Text>
												</Group>
											</Table.Td>
										</Table.Tr>
									))}
								</Table.Tbody>
							</Table>
						</Table.ScrollContainer>
					)}
				</Paper>
				</Grid.Col>

				<Grid.Col span={{ base: 12, lg: 4 }}>
				<Paper withBorder radius="md" p="md">
					<Text size="sm" fw={600} mb="sm">
						今日与待办
					</Text>
					<Stack gap="xs">
						<Group justify="space-between">
							<Text size="sm" c="dimmed">
								今日活跃学生
							</Text>
							<Text size="sm" fw={500} className="tabular-nums">
								{today?.students ?? 0}
							</Text>
						</Group>
						<Group justify="space-between">
							<Text size="sm" c="dimmed">
								今日训练
							</Text>
							<Text size="sm" fw={500} className="tabular-nums">
								{today?.total ?? 0}
							</Text>
						</Group>
						<Group justify="space-between">
							<Text size="sm" c="dimmed">
								今日平均分
							</Text>
							<Text size="sm" fw={500} className="tabular-nums">
								{today?.avg_score ?? "—"}
							</Text>
						</Group>
						<Group justify="space-between">
							<Text size="sm" c="dimmed">
								活跃作业
							</Text>
							<Text size="sm" fw={500} className="tabular-nums">
								{assignmentsQuery.data?.total ?? 0}
							</Text>
						</Group>
						<Group justify="space-between">
							<Text size="sm" c="dimmed">
								待批阅
							</Text>
							<Text size="sm" fw={500} c={pendingTotal > 0 ? "red" : undefined} className="tabular-nums">
								{pendingTotal}
							</Text>
						</Group>
					</Stack>
				</Paper>
				</Grid.Col>
			</Grid>

			<Group justify="flex-start">
				<Text size="xs" c="dimmed" component={Link} to="/admin/records">
					查看训练记录 →
				</Text>
				<Text size="xs" c="dimmed" component={Link} to="/admin/assignments">
					查看作业 →
				</Text>
			</Group>
		</Stack>
	);
}
