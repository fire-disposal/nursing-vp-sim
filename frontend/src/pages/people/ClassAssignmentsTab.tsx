import { Badge, Button, Group, Progress, Stack, Table, Text } from "@mantine/core";
import { IconClipboardList } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import type { components } from "@/api/api-types.gen";
import { getAssignments } from "@/api/assignments";
import { queryKeys } from "@/api/query-keys";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import EmptyState from "@/components/ui/empty-state";
import ErrorState from "@/components/ui/error-state";
import LoadingSkeleton from "@/components/ui/loading-skeleton";
import Pagination from "@/components/ui/pagination";
import TableScroll from "@/components/ui/table-scroll";
import { formatDateTime } from "@/utils/date";
import { CLASS_TAB_PARAMS } from "./class-workspace-tabs";

type AssignmentListItem = components["schemas"]["AssignmentListItem"];

const LIMIT = 20;

/** 作业窗口状态：未开始 / 进行中 / 已结束（关闭或过了截止时间）。 */
function windowStatus(item: AssignmentListItem): {
	label: string;
	color: string;
} {
	if (item.is_closed) return { label: "已关闭", color: "gray" };
	const now = Date.now();
	const start = new Date(item.start_time).getTime();
	const end = new Date(item.end_time).getTime();
	if (Number.isFinite(end) && now > end) return { label: "已结束", color: "gray" };
	if (Number.isFinite(start) && now < start) return { label: "未开始", color: "yellow" };
	return { label: "进行中", color: "green" };
}

function completionRate(item: AssignmentListItem): number {
	if (item.student_count <= 0) return 0;
	return Math.min(100, Math.round((item.completed_count / item.student_count) * 100));
}

function formatWindow(item: AssignmentListItem): string {
	const start = formatDateTime(item.start_time);
	const end = formatDateTime(item.end_time);
	if (!start && !end) return "未设置时间窗口";
	return `${start || "—"} 至 ${end || "—"}`;
}

interface AssignmentsTabProps {
	classId: number;
	offset: number;
	onParamsChange: (updates: Array<[string, string]>) => void;
}

/**
 * 作业页签 —— 本班作业的真实内容（状态、窗口、完成率），而不是「去作业列表」的链接。
 * 行内下钻 `/admin/assignments/:id` 看接收人明细与改期。
 */
export default function ClassAssignmentsTab({
	classId,
	offset,
	onParamsChange,
}: AssignmentsTabProps) {
	const navigate = useNavigate();
	const key = CLASS_TAB_PARAMS.assignments.offset;
	const params = { class_id: classId, offset, limit: LIMIT };

	const { data, isLoading, isError, error, refetch } = useQuery({
		queryKey: queryKeys.assignments.list(params),
		queryFn: () => getAssignments(params).then((r) => r.data),
		staleTime: 60_000,
	});

	const items = data?.items ?? [];
	const total = data?.total ?? 0;

	return (
		<Card>
			<CardHeader>
				<CardTitle>
					<Group gap={8} wrap="nowrap" justify="space-between" w="100%">
						<Group gap={8} wrap="nowrap">
							<IconClipboardList size={16} />
							<Text component="span" fw={600} inherit>
								本班作业
							</Text>
						</Group>
						<Text size="xs" c="dimmed" className="tabular-nums">
							{isError ? "—" : `共 ${total} 个`}
						</Text>
					</Group>
				</CardTitle>
			</CardHeader>
			<CardContent>
				{isError ? (
					<ErrorState
						title="作业列表加载失败"
						error={error}
						onRetry={() => refetch()}
					/>
				) : isLoading ? (
					<LoadingSkeleton variant="spinner" message="加载作业中…" />
				) : items.length === 0 ? (
					<EmptyState
						icon={IconClipboardList}
						title="本班暂无作业"
						description="教师发布练习后，作业会连同完成率出现在这里"
						action={
							<Button
								size="xs"
								variant="default"
								onClick={() => navigate(`/admin/assignments?class_id=${classId}`)}
							>
								去作业管理发布
							</Button>
						}
					/>
				) : (
					<>
						<TableScroll minWidth={720}>
							<Table highlightOnHover verticalSpacing="sm">
								<Table.Thead>
									<Table.Tr>
										<Table.Th style={{ minWidth: 180 }}>作业</Table.Th>
										<Table.Th style={{ minWidth: 140 }}>病例</Table.Th>
										<Table.Th style={{ width: 96, whiteSpace: "nowrap" }}>状态</Table.Th>
										<Table.Th style={{ minWidth: 160 }}>完成情况</Table.Th>
										<Table.Th style={{ minWidth: 180, whiteSpace: "nowrap" }}>
											时间窗口
										</Table.Th>
									</Table.Tr>
								</Table.Thead>
								<Table.Tbody>
									{items.map((item) => {
										const status = windowStatus(item);
										const rate = completionRate(item);
										return (
											<Table.Tr
												key={item.id}
												style={{ cursor: "pointer" }}
												onClick={() => navigate(`/admin/assignments/${item.id}`)}
											>
												<Table.Td>
													{/* 行整行可点，但键盘/读屏要靠真链接 */}
													<Text
														size="sm"
														fw={500}
														c="brand"
														component="a"
														href={`/admin/assignments/${item.id}`}
														onClick={(e) => {
															e.preventDefault();
															navigate(`/admin/assignments/${item.id}`);
														}}
														style={{ wordBreak: "break-word" }}
													>
														{item.title || "未命名作业"}
													</Text>
													<Text size="xs" c="dimmed" mt={2}>
														{item.teacher_name || "未知教师"} · 发布{" "}
														{formatDateTime(item.created_at) || "—"}
													</Text>
												</Table.Td>
												<Table.Td>
													<Text size="sm">{item.case_name || "—"}</Text>
												</Table.Td>
												<Table.Td>
													<Badge variant="light" color={status.color} size="sm">
														{status.label}
													</Badge>
												</Table.Td>
												<Table.Td>
													<Group gap={6} wrap="nowrap" align="center">
														<Progress
															value={rate}
															size="sm"
															color={rate >= 100 ? "teal" : "blue"}
															style={{ flex: 1, minWidth: 60 }}
															aria-label={`完成率 ${rate}%`}
														/>
														<Text size="xs" className="tabular-nums" style={{ whiteSpace: "nowrap" }}>
															{item.completed_count}/{item.student_count}
														</Text>
													</Group>
												</Table.Td>
												<Table.Td>
													<Text size="xs" c="dimmed" className="tabular-nums">
														{formatWindow(item)}
													</Text>
												</Table.Td>
											</Table.Tr>
										);
									})}
								</Table.Tbody>
							</Table>
						</TableScroll>
						{total > LIMIT && (
							<Stack mt="sm">
								<Pagination
									total={total}
									offset={offset}
									limit={LIMIT}
									onChange={(next) => onParamsChange([[key, next > 0 ? String(next) : ""]])}
								/>
							</Stack>
						)}
					</>
				)}
			</CardContent>
		</Card>
	);
}
