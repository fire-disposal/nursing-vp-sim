import RecordSubPageLayout from "@/components/shell/RecordSubPageLayout";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge, Box, Button, Group, Paper, Select, Stack, Text, UnstyledButton } from "@mantine/core";
import { IconCircleX, IconClipboardList, IconPlayerPlay, IconTrash } from "@tabler/icons-react";
import { useCallback, useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { abandonRecord, deleteRecord, getRecords } from "@/api";
import type { components } from "@/api/api-types.gen";
import { queryKeys } from "@/api/query-keys";
import { useToast } from "@/components/Toast";
import ErrorDisplay from "@/components/ui/error-display";
import { useConfirm } from "@/components/ui/confirm";
import EmptyState from "@/components/ui/empty-state";
import Pagination from "@/components/ui/pagination";
import LoadingSkeleton from "@/components/ui/loading-skeleton";
import { TextInput } from "@mantine/core";
import { Table } from "@mantine/core";

type TrainingRecordBrief = components["schemas"]["TrainingRecordBrief"];

const LIMIT = 50;

/** Extract repeated field access. Returns minutes or null. */
function recordDurMins(r: TrainingRecordBrief): number | null {
	if (!r.end_time) return null;
	return Math.round(
		(new Date(r.end_time).getTime() - new Date(r.start_time).getTime()) / 60000,
	);
}

/** Narrow status used in both mobile cards and desktop table. */
type RecordStatus = "completed" | "in_progress" | "abandoned";
function recordStatus(r: TrainingRecordBrief): RecordStatus {
	if (r.status === "completed" || r.status === "in_progress" || r.status === "abandoned")
		return r.status;
	return "in_progress"; // fallback
}

const DIM = { color: "var(--mantine-color-gray-6)" } as const;

export default function History() {
	const [searchParams, setSearchParams] = useSearchParams();
	const navigate = useNavigate();
	const toast = useToast();
	const { confirm } = useConfirm();
	const queryClient = useQueryClient();

	const status = searchParams.get("status") || "";
	const date_from = searchParams.get("date_from") || "";
	const date_to = searchParams.get("date_to") || "";
	const offset = parseInt(searchParams.get("offset") || "0", 10);

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

	const params = useMemo(() => {
		const p: Record<string, unknown> = { offset, limit: LIMIT };
		if (status) p.status = status;
		if (date_from) p.date_from = date_from;
		if (date_to) p.date_to = date_to;
		return p;
	}, [offset, status, date_from, date_to]);

	const { data, isLoading, isError, error, refetch } = useQuery({
		queryKey: queryKeys.training.records(params),
		queryFn: () => getRecords(params).then((r) => r.data),
		staleTime: 2 * 60_000,
		placeholderData: keepPreviousData,
	});

	const records = data?.items ?? [];
	const total = data?.total ?? 0;

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

	const clearFilters = () => {
		setSearchParams({}, { replace: true });
	};

	return (
		<RecordSubPageLayout title="训练记录" icon={IconClipboardList}>
			<Paper withBorder radius="md" p="md">
				<Group gap="xs" align="center" wrap="wrap">
					<Text size="xs" c="dimmed">
						共 {total} 条
					</Text>
					{records.length > 0 && (
						<Text size="xs" c="dimmed">
							· 已完成 {records.filter((r) => r.status === "completed").length}
						</Text>
					)}
					<Box style={{ flex: 1 }} />
					<Box w={120}>
						<Select
							data={[{ value: "all", label: "全部状态" }, { value: "in_progress", label: "进行中" }, { value: "completed", label: "已完成" }, { value: "abandoned", label: "已放弃" }]}
							value={status || "all"}
							onChange={(v) => setParam("status", v === "all" ? "" : v ?? "")}
							placeholder="全部状态"
							size="xs"
							allowDeselect={false}
						/>
					</Box>
					<TextInput
						type="date"
						size="xs"
						w={140}
						value={date_from}
						onChange={(e) => setParam("date_from", e.target.value)}
					/>
					<TextInput
						type="date"
						size="xs"
						w={140}
						value={date_to}
						onChange={(e) => setParam("date_to", e.target.value)}
					/>
					<Button variant="outline" size="xs" onClick={clearFilters}>
						清除
					</Button>
				</Group>
			</Paper>

			{isLoading ? (
				<LoadingSkeleton variant="spinner" message="加载中..." />
			) : isError ? (
				<ErrorDisplay
					icon={IconClipboardList}
					message={(error as { response?: { data?: { detail?: string } } })
						?.response?.data?.detail || "加载记录失败"}
					onRetry={() => refetch()}
				/>
			) : records.length === 0 ? (
				<Paper withBorder radius="md">
					<EmptyState icon={IconClipboardList} title="暂无训练记录" description="前往病例列表选择病例开始训练" />
				</Paper>
			) : (
				<Paper withBorder radius="md" style={{ overflow: "hidden" }}>
					{/* Mobile: card list */}
					<Box hiddenFrom="md" p="xs">
						<Stack gap="xs">
							{records.map((r) => {
								const durMins = recordDurMins(r);
								const status = recordStatus(r);
								return (
									<Paper key={r.id} withBorder radius="md" p="sm">
										<UnstyledButton
											onClick={() => navigate(`/record/${r.id}`)}
											style={{ width: "100%", textAlign: "left" }}
										>
											<Group justify="space-between" align="flex-start" gap="xs" wrap="nowrap">
												<Box style={{ minWidth: 0, flex: 1 }}>
													<Group gap="xs" wrap="nowrap">
														<Text size="sm" fw={600} truncate>
															{r.case_name}
														</Text>
														{r.assignment_title && (
															<Badge size="xs">
																作业
															</Badge>
														)}
													</Group>
													<Text size="xs" c="dimmed" mt={2}>
														{new Date(r.start_time).toLocaleString("zh-CN", {
															month: "numeric", day: "numeric",
															hour: "2-digit", minute: "2-digit",
														})}
														{" · 问诊"}
														{durMins != null ? ` · ${durMins} 分钟` : ""}
													</Text>
												</Box>
												<Box style={{ flexShrink: 0 }}>
													{status === "completed" ? (
														<Text size="xs" fw={600} style={{ fontVariantNumeric: "tabular-nums" }}>
															{r.score_total != null ? `${r.score_total} 分` : "评分中"}
														</Text>
													) : status === "abandoned" ? (
														<Text size="xs" c="dimmed">
															已放弃
														</Text>
													) : (
														<Badge variant="light" color="blue">进行中</Badge>
													)}
												</Box>
											</Group>
										</UnstyledButton>
										<Group gap="xs" mt="xs" pt="xs" wrap="nowrap" style={{ borderTop: "1px solid var(--mantine-color-gray-3)" }}>
											{status === "in_progress" && (
												<>
													<Button
														variant="outline"
														size="xs"
														style={{ flex: 1 }}
														onClick={(e) => {
															e.stopPropagation();
															navigate(`/training/${r.id}`);
														}}
													>
														<IconPlayerPlay size={12} /> 继续
													</Button>
													<Button
														variant="subtle" color="gray"
														size="xs"
														onClick={(e) => {
															e.stopPropagation();
															handleAbandonRecord(r);
														}}
													>
														<IconCircleX size={12} /> 放弃
													</Button>
												</>
											)}
											{status === "abandoned" && (
												<Button
													variant="subtle" color="gray"
													size="xs"
													style={{ flex: 1 }}
													onClick={(e) => {
														e.stopPropagation();
														navigate(`/record/${r.id}`);
													}}
												>
													查看
												</Button>
											)}
											<Button
												variant="subtle"
												color="red"
												size="xs"
												style={{ marginLeft: "auto" }}
												onClick={(e) => {
													e.stopPropagation();
													handleDeleteRecord(r);
												}}
											>
												<IconTrash size={12} /> 删除
											</Button>
										</Group>
									</Paper>
								);
							})}
						</Stack>
					</Box>

					<Box visibleFrom="md" style={{ overflowX: "auto" }}>
						<Table>
							<Table.Thead>
								<Table.Tr>
									<Table.Th style={{ fontWeight: 600, fontSize: 12 }}>病例</Table.Th>
									<Table.Th style={{ fontWeight: 600, fontSize: 12 }}>类型</Table.Th>
									<Table.Th style={{ fontWeight: 600, fontSize: 12 }}>来源</Table.Th>
									<Table.Th style={{ fontWeight: 600, fontSize: 12 }}>开始时间</Table.Th>
									<Table.Th style={{ fontWeight: 600, fontSize: 12 }}>时长</Table.Th>
									<Table.Th style={{ fontWeight: 600, fontSize: 12 }}>状态</Table.Th>
									<Table.Th style={{ fontWeight: 600, fontSize: 12 }}>得分</Table.Th>
									<Table.Th style={{ fontWeight: 600, fontSize: 12 }}>操作</Table.Th>
								</Table.Tr>
							</Table.Thead>
							<Table.Tbody>
								{records.map((r) => {
									const durMins = recordDurMins(r);
									return (
										<Table.Tr key={r.id}>
											<Table.Td style={{ fontWeight: 500 }}>{r.case_name}</Table.Td>
											<Table.Td>
												<Badge variant="light" color="gray">问诊</Badge>
											</Table.Td>
											<Table.Td style={{ fontSize: 12, ...DIM }}>
												{r.assignment_title ? (
													<Badge size="xs">作业</Badge>
												) : (
													<Text component="span" size="xs" c="dimmed" opacity={0.4}>
														自由训练
													</Text>
												)}
											</Table.Td>
											<Table.Td style={{ fontSize: 12, ...DIM }}>
												{new Date(r.start_time).toLocaleString("zh-CN")}
											</Table.Td>
											<Table.Td style={{ fontSize: 12, ...DIM }}>
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
													<Text component="span" c="dimmed" opacity={0.4}>
														-
													</Text>
												)}
											</Table.Td>
											<Table.Td>
												<Group gap="xs" wrap="nowrap">
													{r.status === "in_progress" && (
														<>
															<Button
																variant="transparent"
																size="xs"
																onClick={() => navigate(`/training/${r.id}`)}
															>
																继续训练
															</Button>
															<Button
																variant="transparent"
																size="xs"
																onClick={() => handleAbandonRecord(r)}
															>
																放弃
															</Button>
														</>
													)}
													{(r.status === "completed" || r.status === "abandoned") && (
														<Button
															variant="transparent"
															size="xs"
															onClick={() => navigate(`/record/${r.id}`)}
														>
															{r.status === "abandoned" ? "查看" : "查看详情"}
														</Button>
													)}
													<Button
														variant="subtle"
														color="red"
														size="xs" w={32} h={32} p={0}
														onClick={() => handleDeleteRecord(r)}
														aria-label="删除记录"
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
					</Box>
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
		</RecordSubPageLayout>
	);
}
