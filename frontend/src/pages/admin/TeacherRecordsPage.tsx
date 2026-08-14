import { Badge, Button, Group, Paper, Select, SimpleGrid, Stack, Text } from "@mantine/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { IconArrowDown, IconArrowUp, IconArrowsUpDown, IconClipboardList, IconTrash } from "@tabler/icons-react";
import ErrorDisplay from "@/components/ui/error-display";
import LoadingSkeleton from "@/components/ui/loading-skeleton";
import { useCallback, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { abandonRecord, deleteRecord, getCases, getRecords } from "@/api";
import type { components } from "@/api/api-types.gen";
import { Checkbox } from "@mantine/core";
import { queryKeys } from "@/api/query-keys";
import ClassFilter from "@/components/admin/ClassFilter";
import { useToast } from "@/components/Toast";
import { useConfirm } from "@/components/ui/confirm";
import EmptyState from "@/components/ui/empty-state";
import { TextInput } from "@mantine/core";
import PageHeader from "@/components/ui/page-header";
import Pagination from "@/components/ui/pagination";
import StatCard from "@/components/ui/stat-card";
import { Table } from "@mantine/core";
import { useDebouncedSearch } from "@/hooks/useDebouncedSearch";

type TrainingRecordBrief = components["schemas"]["TrainingRecordBrief"];

type SortField = "start_time" | "score_total" | "duration" | null;
type SortDir = "asc" | "desc";

const LIMIT = 50;

function durationMinutes(r: TrainingRecordBrief): number | null {
	if (!r.end_time) return null;
	return Math.round(
		(new Date(r.end_time).getTime() - new Date(r.start_time).getTime()) / 60000,
	);
}

export default function TeacherRecordsPage() {
	const [searchParams, setSearchParams] = useSearchParams();
	const navigate = useNavigate();
	const toast = useToast();
	const { confirm } = useConfirm();
	const queryClient = useQueryClient();

	const [sortField, setSortField] = useState<SortField>(null);
	const [sortDir, setSortDir] = useState<SortDir>("desc");

	const student_name = searchParams.get("student_name") || "";
	const case_id = searchParams.get("case_id") || "";
	const status = searchParams.get("status") || "";
	const training_type = searchParams.get("training_type") || "";
	const date_from = searchParams.get("date_from") || "";
	const date_to = searchParams.get("date_to") || "";
	const exclude_is_test = searchParams.get("exclude_is_test") !== "false";
	const class_id = searchParams.get("class_id") || "";
	const offset = parseInt(searchParams.get("offset") || "0", 10);

	const { searchInput, debouncedValue: debouncedStudent, handleSearchChange } =
		useDebouncedSearch(student_name, 300);

	const setParam = useCallback(
		(key: string, value: string) => {
			const next = new URLSearchParams(searchParams);
			if (value) {
				next.set(key, value);
			} else {
				next.delete(key);
			}
			if (key !== "offset") next.set("offset", "0");
			setSearchParams(next, { replace: true });
		},
		[searchParams, setSearchParams],
	);

	const { data: casesData } = useQuery({
		queryKey: queryKeys.cases.lists(),
		queryFn: () => getCases({ limit: 100, offset: 0 }).then((r) => r.data),
		staleTime: 5 * 60_000,
	});
	const caseOptions = casesData?.items ?? [];

	const params = useMemo(() => {
		const p: Record<string, unknown> = { offset, limit: LIMIT };
		if (debouncedStudent) p.student_name = debouncedStudent;
		if (case_id) p.case_id = Number(case_id);
		if (status) p.status = status;
		if (training_type) p.training_type = training_type;
		if (date_from) p.date_from = date_from;
		if (date_to) p.date_to = date_to;
		if (class_id) p.class_id = Number(class_id);
		if (exclude_is_test) p.exclude_is_test = true;
		// 排序交由服务端执行：按分数/时长排序需全局正确，不能只排当前页
		if (sortField) {
			p.sort_by = sortField;
			p.order = sortDir;
		}
		return p;
	}, [offset, debouncedStudent, case_id, status, training_type, date_from, date_to, class_id, exclude_is_test, sortField, sortDir]);

	const { data, isLoading, isError, error, refetch } = useQuery({
		queryKey: queryKeys.training.records(params),
		queryFn: () => getRecords(params).then((r) => r.data),
		staleTime: 2 * 60_000,
	});

	const records = data?.items ?? [];
	const total = data?.total ?? 0;

	// 排序由服务端执行（sort_by/order 参数），本地不再排序
	const sortedRecords = records;

	const handleSort = (field: SortField) => {
		if (sortField === field) {
			setSortDir((d) => (d === "asc" ? "desc" : "asc"));
		} else {
			setSortField(field);
			setSortDir("desc");
		}
	};

	const sortIcon = (field: SortField) => {
		if (sortField !== field)
			return <IconArrowsUpDown size={12} style={{ color: "var(--mantine-color-dimmed)", opacity: 0.5, marginLeft: 4 }} />;
		return sortDir === "asc" ? (
			<IconArrowUp size={12} style={{ marginLeft: 4 }} />
		) : (
			<IconArrowDown size={12} style={{ marginLeft: 4 }} />
		);
	};

	const stats = useMemo(() => {
		const completed = records.filter((r) => r.status === "completed");
		const scored = completed.filter(
			(r) => r.scoring_status === "completed" && r.score_total != null,
		);
		const avgScore =
			scored.length > 0
				? scored.reduce((sum, r) => sum + (r.score_total ?? 0), 0) / scored.length
				: null;
		const scoringRate =
			total > 0
				? Math.round((scored.length / total) * 100)
				: 0;
		return {
			completed: completed.length,
			scored: scored.length,
			avgScore,
			scoringRate,
		};
	}, [records, total]);

	const deleteMutation = useMutation({
		mutationFn: (id: number) => deleteRecord(id),
		onSuccess: () => {
			toast.success("训练记录已删除");
			queryClient.invalidateQueries({ queryKey: queryKeys.training.all });
		},
		onError: (err: unknown) => {
			toast.apiError(err, "删除失败");
		},
	});

	const handleDeleteRecord = async (r: TrainingRecordBrief) => {
		const ok = await confirm({
			title: "删除记录",
			message: `确定删除「${r.case_name}」的训练记录吗？此操作不可撤销。`,
			confirmLabel: "确定删除",
			danger: true,
		});
		if (!ok) return;
		deleteMutation.mutate(r.id);
	};

	const abandonMutation = useMutation({
		mutationFn: (id: number) => abandonRecord(id),
		onSuccess: () => {
			toast.success("训练记录已放弃");
			queryClient.invalidateQueries({ queryKey: queryKeys.training.all });
		},
		onError: (err: unknown) => toast.apiError(err, "操作失败"),
	});

	const handleAbandonRecord = async (r: TrainingRecordBrief) => {
		const ok = await confirm({
			title: "放弃训练",
			message: `确定放弃「${r.case_name}」的训练吗？放弃后将保留对话记录但不会评分。`,
			confirmLabel: "确定放弃",
			danger: true,
		});
		if (!ok) return;
		abandonMutation.mutate(r.id);
	};

	const handleClearFilters = () => {
		setSearchParams({}, { replace: true });
	};

	const handleClassFilterChange = useCallback(
		(params: { grade_id: number | null; class_id: number | null }) => {
			setParam("class_id", params.class_id != null ? String(params.class_id) : "");
		},
		[setParam],
	);

	return (
		<>
			<PageHeader
				title="训练记录管理"
				subtitle="查看和管理所有学生的训练记录"
				icon={IconClipboardList}
			/>

			<Stack gap="md">
				<Paper withBorder radius="md" p="md">
					<SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }} spacing="md">
						<Stack gap={6}>
							<Text size="xs" fw={500} c="dimmed">班级</Text>
							<ClassFilter
								classId={class_id ? Number(class_id) : undefined}
								onChange={handleClassFilterChange}
							/>
						</Stack>
						<Stack gap={6}>
							<Text size="xs" fw={500} c="dimmed">学生搜索</Text>
							<TextInput
								placeholder="搜索学生姓名或学号..."
								aria-label="搜索学生姓名或学号"
								value={searchInput}
								onChange={(e) => handleSearchChange(e.target.value)}
							/>
						</Stack>
						<Stack gap={6}>
							<Text size="xs" fw={500} c="dimmed">病例</Text>
							<Select
								value={case_id || null}
								onChange={(v) => setParam("case_id", v ?? "")}
								data={[
									{ value: "", label: "全部病例" },
									...caseOptions.map((c) => ({
										value: String(c.id),
										label: c.name,
									})),
								]}
							/>
						</Stack>
						<Stack gap={6}>
							<Text size="xs" fw={500} c="dimmed">状态</Text>
							<Select
								value={status || null}
								onChange={(v) => setParam("status", v ?? "")}
								data={[
									{ value: "", label: "全部" },
									{ value: "in_progress", label: "进行中" },
									{ value: "completed", label: "已完成" },
									{ value: "abandoned", label: "已放弃" },
								]}
							/>
						</Stack>
						<Stack gap={6}>
							<Text size="xs" fw={500} c="dimmed">类型</Text>
							<Select
								value={training_type || null}
								onChange={(v) => setParam("training_type", v ?? "")}
								data={[
									{ value: "", label: "全部" },
									{ value: "history_taking", label: "问诊" },
								]}
							/>
						</Stack>
						<Stack gap={6}>
							<Text size="xs" fw={500} c="dimmed">开始日期(起)</Text>
							<TextInput
								type="date"
								value={date_from}
								onChange={(e) => setParam("date_from", e.target.value)}
							/>
						</Stack>
						<Stack gap={6}>
							<Text size="xs" fw={500} c="dimmed">开始日期(止)</Text>
							<TextInput
								type="date"
								value={date_to}
								onChange={(e) => setParam("date_to", e.target.value)}
							/>
						</Stack>
						<Group gap={8} align="center" wrap="wrap" style={{ alignSelf: "end" }}>
							<Checkbox
								label="排除试跑"
								checked={exclude_is_test}
								onChange={(e) => setParam("exclude_is_test", e.currentTarget.checked ? "true" : "false")}
							/>
							<Button variant="outline" onClick={handleClearFilters}>
								清除过滤
							</Button>
						</Group>
					</SimpleGrid>
				</Paper>

				{/* Stats bar */}
				<SimpleGrid cols={{ base: 2, sm: 4 }} spacing="sm">
					<StatCard value={total} label="筛选结果" color="blue" />
					<StatCard value={stats.completed} label="已完成" color="green" />
					<StatCard value={stats.avgScore != null ? stats.avgScore.toFixed(1) : "-"} label="平均分" color="blue" />
					<StatCard value={`${stats.scoringRate}%`} label="评分完成率" color="amber" />
				</SimpleGrid>

				{isLoading ? (
					<LoadingSkeleton variant="spinner" message="加载中..." />
				) : isError ? (
					<ErrorDisplay
						icon={IconClipboardList}
						message={(error as { response?: { data?: { detail?: string } } })
							?.response?.data?.detail || "加载记录失败"}
						onRetry={() => refetch()}
					/>
				) : sortedRecords.length === 0 ? (
					<Paper withBorder radius="md">
						<EmptyState icon={IconClipboardList} title="暂无训练记录" description="当前筛选条件下没有找到训练记录" />
					</Paper>
				) : (
					<Paper withBorder radius="md" style={{ overflow: "hidden" }}>
						<div style={{ overflowX: "auto" }}>
							<Table>
								<Table.Thead>
									<Table.Tr>
										<Table.Th>学生</Table.Th>
										<Table.Th>学号</Table.Th>
										<Table.Th>病例</Table.Th>
										<Table.Th>类型</Table.Th>
										<Table.Th>来源</Table.Th>
										<Table.Th style={{ cursor: "pointer" }} onClick={() => handleSort("start_time")}>
											开始时间{sortIcon("start_time")}
										</Table.Th>
										<Table.Th
											style={{ cursor: "pointer" }}
											onClick={() => handleSort("duration")}
										>
											时长{sortIcon("duration")}
										</Table.Th>
										<Table.Th>状态</Table.Th>
										<Table.Th style={{ cursor: "pointer" }} onClick={() => handleSort("score_total")}>
											得分{sortIcon("score_total")}
										</Table.Th>
										<Table.Th>评分状态</Table.Th>
										<Table.Th>操作</Table.Th>
									</Table.Tr>
								</Table.Thead>
								<Table.Tbody>
									{sortedRecords.map((r) => {
										const durMins = durationMinutes(r);
										return (
											<Table.Tr key={r.id}>
												<Table.Td>{r.user_display_name}</Table.Td>
												<Table.Td style={{ color: "var(--mantine-color-dimmed)" }}>{r.user_student_id ?? ""}</Table.Td>
												<Table.Td style={{ fontWeight: 500 }}>{r.case_name}</Table.Td>
												<Table.Td>
													<Badge variant="light" color="gray">问诊</Badge>
												</Table.Td>
												<Table.Td>
													{r.assignment_title ? (
														<Badge variant="light" color="blue" size="xs">作业</Badge>
													) : (
														<Text size="xs" c="dimmed" opacity={0.4}>自由训练</Text>
													)}
												</Table.Td>
												<Table.Td style={{ fontSize: 12, color: "var(--mantine-color-dimmed)" }}>
													{new Date(r.start_time).toLocaleString("zh-CN")}
												</Table.Td>
												<Table.Td style={{ fontSize: 12, color: "var(--mantine-color-dimmed)", opacity: durMins != null ? 1 : 0.5 }}>
													{durMins != null ? `${durMins} 分钟` : "进行中"}
												</Table.Td>
												<Table.Td>
													<Badge
														variant="light" color={r.status === "completed" ? "green" :
															r.status === "abandoned" ? "gray" :
															"blue"}
													>
														{r.status === "completed" ? "已完成" :
														 r.status === "abandoned" ? "已放弃" :
														 "进行中"}
													</Badge>
												</Table.Td>
												<Table.Td>
													{r.score_total != null ? (
														<Text component="span" fw={600} c="blue">
															{r.score_total}分
														</Text>
													) : r.scoring_status === "pending" ||
														r.scoring_status === "processing" ? (
														<Badge variant="light" color="yellow">评分中...</Badge>
													) : r.scoring_status === "failed" ? (
														<Text
															component="span"
															size="xs"
															c="red"
															title={r.scoring_error ?? undefined}
														>
															评分失败
														</Text>
													) : (
														<Text component="span" c="dimmed" opacity={0.4}>-</Text>
													)}
												</Table.Td>
												<Table.Td>
													{r.scoring_status === "completed" ? (
														<Badge variant="light" color="green">已完成</Badge>
													) : r.scoring_status === "pending" ||
														r.scoring_status === "processing" ? (
														<Badge variant="light" color="yellow">评分中</Badge>
													) : r.scoring_status === "failed" ? (
														<Badge variant="light" color="red">失败</Badge>
													) : (
														<Text component="span" c="dimmed" opacity={0.4}>-</Text>
													)}
												</Table.Td>
												<Table.Td>
													<Group gap={8} wrap="nowrap">
														<Button
															variant="transparent"
															size="xs"
															onClick={() => navigate(`/record/${r.id}`)}
														>
															查看详情
														</Button>
														{r.status === "in_progress" && (
															<Button
																variant="transparent"
																size="xs"
																color="gray"
																onClick={() => handleAbandonRecord(r)}
															>
																放弃
															</Button>
														)}
														<Button
															variant="subtle"
															size="xs" w={32} h={32} p={0}
															color="red"
															onClick={() => handleDeleteRecord(r)}
														>
															<IconTrash size={14} />
														</Button>
													</Group>
												</Table.Td>
											</Table.Tr>
										);
									})}
								</Table.Tbody>
							</Table>
						</div>
					</Paper>
				)}

				<Paper withBorder radius="md" px="md" py="sm">
					<Pagination
						total={total}
						offset={offset}
						limit={LIMIT}
						onChange={(newOffset) => setParam("offset", String(newOffset))}
					/>
				</Paper>
			</Stack>
		</>
	);
}
