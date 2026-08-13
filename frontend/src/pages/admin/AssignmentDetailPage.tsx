import { Anchor, Box, Group, Paper, Progress, Select, SimpleGrid, Stack, Text } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { IconArrowLeft, IconCopy, IconDownload } from "@tabler/icons-react";
import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { exportAssignment, getAssignment } from "@/api/assignments";
import { queryKeys } from "@/api/query-keys";
import { useToast } from "@/components/Toast";
import Badge from "@/components/ui/badge";
import Button from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import LoadingSkeleton from "@/components/ui/loading-skeleton";
import PageHeader from "@/components/ui/page-header";
import { SearchInput } from "@/components/ui/search-input";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";

function statusBadge(status: string) {
	switch (status) {
		case "not_started":
			return <Badge variant="secondary">未开始</Badge>;
		case "in_progress":
			return <Badge variant="info">进行中</Badge>;
		case "completed":
			return <Badge variant="success">已完成</Badge>;
		case "overdue":
			return <Badge variant="destructive">已逾期</Badge>;
		default:
			return <Badge variant="secondary">{status}</Badge>;
	}
}

export default function AssignmentDetailPage() {
	const { id } = useParams<{ id: string }>();
	const navigate = useNavigate();
	const toast = useToast();

	const [studentSearch, setStudentSearch] = useState("");
	const [statusFilter, setStatusFilter] = useState("");

	const { data, isLoading, error } = useQuery({
		queryKey: queryKeys.assignments.detail(id),
		queryFn: () => getAssignment(id!).then((r) => r.data),
		enabled: !!id,
		staleTime: 2 * 60_000,
	});

	const handleExport = async () => {
		if (!id) return;
		try {
			const res = await exportAssignment(id);
			const blob = new Blob([res.data as unknown as BlobPart], {
				type: "text/csv; charset=utf-8-sig",
			});
			const url = URL.createObjectURL(blob);
			const a = document.createElement("a");
			a.href = url;
			a.download = `assignment_${id.slice(0, 8)}.csv`;
			a.click();
			URL.revokeObjectURL(url);
			toast.success("导出成功");
		} catch (e: unknown) {
			toast.error(e instanceof Error ? e.message : "导出失败");
		}
	};

	const filteredStudents = useMemo(() => {
		const students = data?.students ?? [];
		let result = students;
		if (studentSearch) {
			const q = studentSearch.toLowerCase();
			result = result.filter(
				(s) =>
					s.display_name?.toLowerCase().includes(q) ||
					String(s.student_id || "").toLowerCase().includes(q),
			);
		}
		if (statusFilter) {
			result = result.filter((s) => s.status === statusFilter);
		}
		return result;
	}, [data?.students, studentSearch, statusFilter]);

	const allStudents = data?.students ?? [];
	const notStartedCount = allStudents.filter((s) => s.status === "not_started").length;
	const overdueCount = allStudents.filter((s) => s.status === "overdue").length;
	const unfinishedStudents = allStudents.filter((s) => s.status !== "completed");

	const handleCopyUnfinished = async () => {
		const names = unfinishedStudents.map((s) => s.display_name).join("\n");
		try {
			await navigator.clipboard.writeText(names);
			toast.success(`已复制 ${unfinishedStudents.length} 名未完成学生名单`);
		} catch {
			toast.error("复制失败，请手动复制");
		}
	};

	if (isLoading) return <LoadingSkeleton />;
	if (error || !data)
		return (
			<Text ta="center" py={32} c="dimmed">加载失败</Text>
		);

	const detail = data;

	return (
		<Stack gap="xl">
			<PageHeader
				title={detail.title}
				subtitle={
					(() => {
						const base = detail.description
							? `${detail.case_name} · ${detail.class_name} · ${detail.description}`
							: `${detail.case_name} · ${detail.class_name}`;
						const ma = detail.max_attempts;
						const maText =
							ma != null && ma > 0
								? ` · 最多 ${ma} 次`
								: ma === 0
									? " · 不限制次数"
									: "";
						return base + maText;
					})()
				}
				actions={
					<Group gap={8}>
						<Button
							variant="outline"
							onClick={() => navigate("/admin/assignments")}
							leftSection={<IconArrowLeft size={16} />}
						>
							返回
						</Button>
						<Button onClick={handleExport} leftSection={<IconDownload size={16} />}>
							导出成绩
						</Button>
					</Group>
				}
			/>

			<SimpleGrid cols={{ base: 2, md: 4, xl: 7 }} spacing="sm">
				<Paper withBorder radius="lg" p="sm">
					<Text size="xs" c="dimmed">总人数</Text>
					<Text size="xl" fw={700}>{detail.student_count}</Text>
				</Paper>
				<Paper withBorder radius="lg" p="sm">
					<Text size="xs" c="dimmed">已完成</Text>
					<Text size="xl" fw={700} c="green">{detail.completed_count}</Text>
				</Paper>
				<Paper withBorder radius="lg" p="sm">
					<Text size="xs" c="dimmed">未开始</Text>
					<Text size="xl" fw={700} c="dimmed">{notStartedCount}</Text>
				</Paper>
				<Paper withBorder radius="lg" p="sm">
					<Text size="xs" c="dimmed">已逾期</Text>
					<Text size="xl" fw={700} c="red">{overdueCount}</Text>
				</Paper>
				<Paper withBorder radius="lg" p="sm">
					<Text size="xs" c="dimmed">已评分</Text>
					<Text size="xl" fw={700} c="teal">{detail.scored_count}</Text>
				</Paper>
				<Paper withBorder radius="lg" p="sm">
					<Text size="xs" c="dimmed">完成率</Text>
					<Text size="xl" fw={700}>
						{detail.completion_rate != null
							? `${(detail.completion_rate * 100).toFixed(0)}%`
							: "-"}
					</Text>
				</Paper>
				<Paper withBorder radius="lg" p="sm">
					<Text size="xs" c="dimmed">均分/最高</Text>
					<Text size="lg" fw={700}>{detail.avg_score != null ? detail.avg_score : "-"}</Text>
					<Text size="xs" c="dimmed">最高 {detail.max_score ?? "-"} / 最低 {detail.min_score ?? "-"}</Text>
				</Paper>
			</SimpleGrid>

			{detail.avg_score != null && (
				<Card mt="md">
					<CardHeader style={{ paddingBottom: 8 }}>
						<CardTitle>分数分布</CardTitle>
					</CardHeader>
					<CardContent>
						<ScoreDistributionBar students={detail.students ?? []} />
					</CardContent>
				</Card>
			)}

			<Card style={{ overflow: "hidden" }}>
				<CardHeader style={{ paddingBottom: 12 }}>
					<CardTitle>学生完成情况</CardTitle>
				</CardHeader>
				<Group gap={8} px="md" pb="sm" wrap="wrap">
					<Box maw={320} style={{ flex: 1 }}>
						<SearchInput
							value={studentSearch}
							onChange={setStudentSearch}
							placeholder="搜索姓名/学号..."
						/>
					</Box>
					<Select
						value={statusFilter || null}
						onChange={(v) => setStatusFilter(v ?? "")}
						data={[
							{ value: "", label: "全部状态" },
							{ value: "completed", label: "已完成" },
							{ value: "in_progress", label: "进行中" },
							{ value: "not_started", label: "未开始" },
							{ value: "overdue", label: "已逾期" },
						]}
						w={140}
					/>
					<Button
						variant="outline"
						size="sm"
						onClick={handleCopyUnfinished}
						disabled={unfinishedStudents.length === 0}
						title="复制未完成学生名单"
						leftSection={<IconCopy size={14} />}
					>
						复制未完成名单{unfinishedStudents.length > 0 ? ` (${unfinishedStudents.length})` : ""}
					</Button>
				</Group>
				<div style={{ overflowX: "auto" }}>
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>学号</TableHead>
								<TableHead>姓名</TableHead>
								<TableHead>状态</TableHead>
								<TableHead>尝试次数</TableHead>
								<TableHead>得分</TableHead>
								<TableHead>评分状态</TableHead>
								<TableHead>完成时间</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{filteredStudents.map((s) => (
								<TableRow key={s.user_id}>
									<TableCell style={{ fontSize: 12, fontFamily: "var(--mantine-font-family-monospace)" }}>
										{s.student_id || "-"}
									</TableCell>
									<TableCell style={{ fontWeight: 500 }}>
										{s.record_id != null ? (
											<Anchor
												onClick={() => navigate(`/record/${s.record_id}`)}
												c="teal"
												size="sm"
											>
												{s.display_name}
											</Anchor>
										) : (
											s.display_name
										)}
									</TableCell>
									<TableCell>{statusBadge(s.status)}</TableCell>
									<TableCell style={{ fontSize: 12, color: "var(--mantine-color-dimmed)" }}>{s.attempt_count > 0 ? s.attempt_count : "-"}</TableCell>
									<TableCell>
										{s.score_total != null ? (
											<Text component="span" fw={700} inherit>{s.score_total}</Text>
										) : (
											"-"
										)}
										{s.attempt_count > 1 && (
											<Text component="span" size="xs" c="dimmed" ml={4} inherit>
												共{s.attempt_count}次
											</Text>
										)}
									</TableCell>
									<TableCell style={{ fontSize: 12, color: "var(--mantine-color-dimmed)" }}>
										{s.scoring_status === "completed"
											? "已评分"
											: s.scoring_status || "-"}
									</TableCell>
									<TableCell style={{ fontSize: 12, color: "var(--mantine-color-dimmed)" }}>
										{s.end_time
											? new Date(s.end_time).toLocaleString("zh-CN")
											: "-"}
										{s.status === "completed" && s.is_overdue && (
											<Text component="span" size="xs" c="red" ml={4} inherit>逾期提交</Text>
										)}
									</TableCell>
								</TableRow>
							))}
							{filteredStudents.length === 0 && (
								<TableRow>
									<TableCell colSpan={7} style={{ textAlign: "center", color: "var(--mantine-color-dimmed)", paddingTop: 32, paddingBottom: 32 }}>
										{studentSearch || statusFilter ? "无匹配结果" : "该班级暂无学生"}
									</TableCell>
								</TableRow>
							)}
						</TableBody>
					</Table>
				</div>
			</Card>
		</Stack>
	);
}

function ScoreDistributionBar({ students }: { students: { score_total?: number | null; scoring_status?: string | null }[] }) {
	const scored = students
		.filter((s) => s.scoring_status === "completed" && s.score_total != null)
		.map((s) => s.score_total!);
	if (scored.length === 0) return <Text size="xs" c="dimmed">暂无评分数据</Text>;
	const buckets = [
		{ label: "0-59", lo: 0, hi: 59 },
		{ label: "60-69", lo: 60, hi: 69 },
		{ label: "70-79", lo: 70, hi: 79 },
		{ label: "80-89", lo: 80, hi: 89 },
		{ label: "90-100", lo: 90, hi: 100 },
	];
	const counts = buckets.map((b) => scored.filter((s) => s >= b.lo && s <= b.hi).length);
	const max = Math.max(...counts, 1);
	return (
		<Stack gap={6}>
			{buckets.map((b, i) => (
				<Group key={b.label} gap={8} align="center" wrap="nowrap">
					<Text size="xs" c="dimmed" w={40} ta="right">{b.label}</Text>
					<Box style={{ flex: 1 }}>
						<Progress value={(counts[i] / max) * 100} size="lg" radius="sm" />
					</Box>
					<Text size="xs" w={24} ta="right">{counts[i]}</Text>
				</Group>
			))}
		</Stack>
	);
}
