import { Badge, Button, Group, Paper, Select, SimpleGrid, Stack, Text } from "@mantine/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	IconArrowDown, IconArrowUp, IconArrowsUpDown, IconClipboardList, IconPencil, IconShieldCheck, IconTrash } from "@tabler/icons-react";
import ErrorDisplay from "@/components/ui/error-display";
import LoadingSkeleton from "@/components/ui/loading-skeleton";
import { useCallback, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { abandonRecord, deleteRecord, getCases, getRecords } from "@/api";
import type { components } from "@/api/api-types.gen";
import { Checkbox } from "@mantine/core";
import { queryKeys } from "@/api/query-keys";
import ClassFilter, { type ClassFilterParams } from "@/components/admin/ClassFilter";
import { useToast } from "@/components/Toast";
import { useConfirm } from "@/components/ui/confirm";
import EmptyState from "@/components/ui/empty-state";
import PageHeader from "@/components/ui/page-header";
import { FilterToolbar } from "@/components/ui/filter-toolbar";
import { SearchInput } from "@/components/ui/search-input";
import Pagination from "@/components/ui/pagination";
import StatCard from "@/components/ui/stat-card";
import { Table } from "@mantine/core";
import { DatePickerInput } from "@mantine/dates";
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
	const review_status = searchParams.get("review_status") || "";
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
	}, [offset, debouncedStudent, case_id, status, review_status, date_from, date_to, class_id, exclude_is_test, sortField, sortDir]);

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
		(params: ClassFilterParams) => {
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
				<FilterToolbar
					compact
					hasActiveFilters={Boolean(
						debouncedStudent ||
							case_id ||
							status ||
							review_status ||
							class_id ||
							date_from ||
							date_to ||
							!exclude_is_test,
					)}
					onClear={handleClearFilters}
					search={
						<SearchInput
							value={searchInput}
							onChange={handleSearchChange}
							placeholder="搜索学生姓名..."
						/>
					}
					filters={
						<>
							<ClassFilter onChange={handleClassFilterChange} />
							<Select
								size="sm"
								w={150}
								placeholder="全部病例"
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
							<Select
								size="sm"
								w={110}
								placeholder="全部状态"
								value={status || null}
								onChange={(v) => setParam("status", v ?? "")}
								data={[
									{ value: "", label: "全部" },
									{ value: "in_progress", label: "进行中" },
									{ value: "completed", label: "已完成" },
									{ value: "abandoned", label: "已放弃" },
								]}
							/>
							<Select
								size="sm"
								w={110}
								placeholder="全部复核"
								value={review_status || null}
								onChange={(v) => setParam("review_status", v ?? "")}
								data={[
									{ value: "", label: "全部" },
									{ value: "pending", label: "待复核" },
									{ value: "reviewed", label: "已复核" },
								]}
							/>
							{/* 时间范围用一个 range 选择器：原先"开始日期(起)/(止)"两个框语义靠括号、网格末行还会错位 */}
							<DatePickerInput
								type="range"
								size="sm"
								clearable
								w={250}
								valueFormat="YYYY-MM-DD"
								placeholder="训练时间：不限"
								value={[date_from || null, date_to || null]}
								onChange={([from, to]) => {
									setParam("date_from", from ?? "");
									setParam("date_to", to ?? "");
								}}
							/>
							<Checkbox
								size="sm"
								label="排除试跑"
								checked={exclude_is_test}
								onChange={(e) =>
									setParam("exclude_is_test", e.currentTarget.checked ? "true" : "false")
								}
							/>
						</>
					}
				/>

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
					<Paper withBorder>
						<EmptyState icon={IconClipboardList} title="暂无训练记录" description="当前筛选条件下没有找到训练记录" />
					</Paper>
				) : (
					<Paper withBorder style={{ overflow: "hidden" }}>
						<Table.ScrollContainer minWidth={1000}>
							<Table>
								<Table.Thead>
									<Table.Tr>
										<Table.Th style={{ width: 88, whiteSpace: "nowrap" }}>学生</Table.Th>
										<Table.Th style={{ width: 122, whiteSpace: "nowrap" }}>学号</Table.Th>
										<Table.Th style={{ minWidth: 170 }}>病例</Table.Th>
										<Table.Th style={{ width: 84, whiteSpace: "nowrap" }}>来源</Table.Th>
										{/* 「类型」列恒为「问诊」，零信息量，2026-09-26 删除（审计 UI-ADM-6/表格列集） */}
										<Table.Th style={{ width: 132, cursor: "pointer", whiteSpace: "nowrap" }} onClick={() => handleSort("start_time")}>
											开始时间{sortIcon("start_time")}
										</Table.Th>
										<Table.Th
											style={{ width: 76, cursor: "pointer", whiteSpace: "nowrap" }}
											onClick={() => handleSort("duration")}
										>
											时长{sortIcon("duration")}
										</Table.Th>
										<Table.Th style={{ width: 76, whiteSpace: "nowrap" }}>状态</Table.Th>
										<Table.Th style={{ width: 96, cursor: "pointer", whiteSpace: "nowrap" }} onClick={() => handleSort("score_total")}>
											评分{sortIcon("score_total")}
										</Table.Th>
										<Table.Th style={{ width: 132, whiteSpace: "nowrap" }}>操作</Table.Th>
									</Table.Tr>
								</Table.Thead>
								<Table.Tbody>
									{sortedRecords.map((r) => {
										const durMins = durationMinutes(r);
										return (
											<Table.Tr key={r.id}>
												<Table.Td style={{ whiteSpace: "nowrap" }}>{r.user_display_name}</Table.Td>
												<Table.Td style={{ color: "var(--mantine-color-dimmed)", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>
													{r.user_student_id ?? ""}
												</Table.Td>
												<Table.Td style={{ fontWeight: 500 }}>{r.case_name}</Table.Td>
												<Table.Td>
													{r.assignment_title ? (
														<Badge variant="light" color="blue" size="xs">作业</Badge>
													) : (
														<Text size="xs" c="dimmed" opacity={0.4}>自由训练</Text>
													)}
												</Table.Td>
												<Table.Td style={{ fontSize: 12, color: "var(--mantine-color-dimmed)", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>
													{new Date(r.start_time).toLocaleString("zh-CN")}
												</Table.Td>
												<Table.Td style={{ fontSize: 12, color: "var(--mantine-color-dimmed)", whiteSpace: "nowrap", opacity: durMins != null ? 1 : 0.5 }}>
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
													) : r.scoring_status === "completed" ? (
														// 已评分但无分数（异常数据）：保留状态，不显示成空
														<Text component="span" size="xs" c="dimmed">已评分</Text>
													) : (
														<Text component="span" c="dimmed" opacity={0.4}>-</Text>
													)}
												</Table.Td>
												<Table.Td>
													{/* 「待复核/修改复核」与「查看详情」此前都跳到 /admin/records/:id，属重复入口；
													    合并为一个（可复核时用复核措辞），并去掉多余一个按钮的宽度（见表格列集优化）。 */}
													<Group gap="xs" wrap="nowrap">
														{r.scoring_status === "completed" ? (
															<Button
																variant={r.score_reviewed ? "light" : "filled"}
																color={r.score_reviewed ? "green" : "brand"}
																size="xs"
																leftSection={
																	r.score_reviewed ? <IconShieldCheck size={13} /> : <IconPencil size={13} />
																}
																onClick={() => navigate(`/admin/records/${r.id}`)}
															>
																{r.score_reviewed ? "修改复核" : "待复核"}
														</Button>
														) : (
															<Button
																variant="transparent"
																size="xs"
																onClick={() => navigate(`/admin/records/${r.id}`)}
															>
																查看详情
															</Button>
														)}
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
						</Table.ScrollContainer>
					</Paper>
				)}

				<Paper withBorder px="md" py="sm">
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
