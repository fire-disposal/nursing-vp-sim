import { Container, Group, Paper, SimpleGrid, Stack, Text, ThemeIcon } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { IconAward, IconSchool, IconTarget, IconTrendingUp, IconUser } from "@tabler/icons-react";
import { useNavigate, useParams } from "react-router-dom";
import { getClass, getClassSummary } from "@/api/grades-classes";
import { getClassStudents } from "@/api/stats";
import { queryKeys } from "@/api/query-keys";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import EmptyState from "@/components/ui/empty-state";
import LoadingSkeleton from "@/components/ui/loading-skeleton";
import PageHeader from "@/components/ui/page-header";
import StatCard from "@/components/ui/stat-card";

export default function ClassDetailPage() {
	const { classId } = useParams<{ classId: string }>();
	const navigate = useNavigate();
	const cid = Number(classId);

	const { data: cls, isLoading: clsLoading } = useQuery({
		queryKey: queryKeys.grades.classDetail(cid),
		queryFn: () => getClass(cid).then((r) => r.data),
		enabled: !!cid,
	});

	const { data: summary } = useQuery({
		queryKey: queryKeys.grades.classSummary(cid),
		queryFn: () => getClassSummary({ class_id: cid }),
		enabled: !!cid,
	});

	// 学生维度聚合由服务端只读端点完成（无 200 条封顶截断）
	const { data: students } = useQuery({
		queryKey: queryKeys.stats.classStudents(cid),
		queryFn: () => getClassStudents(cid).then((r) => r.data),
		enabled: !!cid,
		staleTime: 60_000,
	});

	if (clsLoading) return <LoadingSkeleton />;
	if (!cls) return <Text ta="center" py={32} c="dimmed">班级不存在</Text>;

	const clsSummary = Array.isArray(summary) ? summary.find((s: { class_id: number }) => s.class_id === cid) : null;
	const studentItems = students ?? [];

	return (
		<Container size="lg" p="md">
			<Stack gap="xl">
				<PageHeader
					title={cls.name}
					subtitle={cls.grade_name}
					backTo="/admin/grades-classes"
				/>

				<SimpleGrid cols={{ base: 2, sm: 4 }} spacing="sm">
					<StatCard icon={IconUser} label="学生数" value={studentItems.length} />
					<StatCard icon={IconTarget} label="训练总数" value={clsSummary?.total_sessions ?? studentItems.reduce((sum, s) => sum + (s.total_sessions ?? 0), 0)} />
					<StatCard icon={IconAward} label="平均得分" value={clsSummary?.avg_score != null ? `${clsSummary.avg_score}分` : "--"} />
					<StatCard icon={IconTrendingUp} label="完成率" value={clsSummary?.completion_rate != null ? `${clsSummary.completion_rate}%` : "--"} />
				</SimpleGrid>

				<Card>
					<CardHeader>
						<CardTitle>
							<Group gap={8} wrap="nowrap">
								<IconSchool size={16} />
								<Text component="span" fw={600} inherit>学生列表</Text>
							</Group>
						</CardTitle>
					</CardHeader>
					<CardContent>
						{studentItems.length === 0 ? (
							<EmptyState icon={IconSchool} title="暂无学生" description="该班级尚无训练记录" />
						) : (
							<SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="sm">
								{studentItems.map((s) => (
									<Paper
										key={s.user_id}
										component="button"
										withBorder
										radius="md"
										p="sm"
										onClick={() => navigate(`/admin/records?user_id=${s.user_id}`)}
										style={{ textAlign: "left", cursor: "pointer", width: "100%" }}
									>
										<Group gap={12} wrap="nowrap">
											<ThemeIcon size={40} radius="md" variant="light" color="brand">
												<IconUser size={18} />
											</ThemeIcon>
											<div style={{ minWidth: 0, flex: 1 }}>
												<Text size="sm" fw={500} truncate>{s.display_name}</Text>
												<Text size="xs" c="dimmed">
													{s.total_sessions} 次训练
													{s.avg_score != null && ` · 均分 ${Math.round(s.avg_score)}`}
												</Text>
											</div>
										</Group>
									</Paper>
								))}
							</SimpleGrid>
						)}
					</CardContent>
				</Card>
			</Stack>
		</Container>
	);
}
