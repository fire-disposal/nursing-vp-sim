import { Container, Group, Paper, SimpleGrid, Stack, Text, ThemeIcon } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { IconAward, IconSchool, IconTarget, IconTrendingUp, IconUser } from "@tabler/icons-react";
import { useNavigate, useParams } from "react-router-dom";
import { getClass, getClassSummary } from "@/api/grades-classes";
import { getRecords } from "@/api";
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

	const { data: records } = useQuery({
		queryKey: queryKeys.training.classRecords(cid),
		queryFn: () => getRecords({ class_id: cid, limit: 200 }).then((r) => r.data),
		enabled: !!cid,
	});

	if (clsLoading) return <LoadingSkeleton />;
	if (!cls) return <Text ta="center" py={32} c="dimmed">班级不存在</Text>;

	const items = records?.items ?? [];
	const clsSummary = Array.isArray(summary) ? summary.find((s: { class_id: number }) => s.class_id === cid) : null;

	const studentMap = new Map<number, { name: string; id: number; total: number; avgScore: number | null; lastDate: string | null }>();
	for (const r of items) {
		const uid = r.user_id;
		const name = r.user_display_name || `用户${uid}`;
		const score = r.score_total;
		const existing = studentMap.get(uid);
		if (existing) {
			existing.total++;
			if (score != null) existing.avgScore = ((existing.avgScore ?? 0) * (existing.total - 1) + score) / existing.total;
		} else {
			studentMap.set(uid, { name, id: uid, total: 1, avgScore: score ?? null, lastDate: r.start_time ?? null });
		}
	}
	const students = [...studentMap.values()].sort((a, b) => b.total - a.total);

	return (
		<Container size="lg" p="md">
			<Stack gap="xl">
				<PageHeader
					title={cls.name}
					subtitle={cls.grade_name}
					backTo="/admin/grades-classes"
				/>

				<SimpleGrid cols={{ base: 2, sm: 4 }} spacing="sm">
					<StatCard icon={IconUser} label="学生数" value={students.length} />
					<StatCard icon={IconTarget} label="训练总数" value={clsSummary?.total_sessions ?? items.length} />
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
						{students.length === 0 ? (
							<EmptyState icon={IconSchool} title="暂无学生" description="该班级尚无训练记录" />
						) : (
							<SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="sm">
								{students.map((s) => (
									<Paper
										key={s.id}
										component="button"
										withBorder
										radius="md"
										p="sm"
										onClick={() => navigate(`/admin/records?user_id=${s.id}`)}
										style={{ textAlign: "left", cursor: "pointer", width: "100%" }}
									>
										<Group gap={12} wrap="nowrap">
											<ThemeIcon size={40} radius="md" variant="light" color="blue">
												<IconUser size={18} />
											</ThemeIcon>
											<div style={{ minWidth: 0, flex: 1 }}>
												<Text size="sm" fw={500} truncate>{s.name}</Text>
												<Text size="xs" c="dimmed">
													{s.total} 次训练
													{s.avgScore != null && ` · 均分 ${Math.round(s.avgScore)}`}
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
