import { Badge, Box, Button, Group, Stack, Table, Text } from "@mantine/core";
import { IconFileText } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { queryKeys } from "@/api/query-keys";
import { type GetRecordsParams, getRecords } from "@/api/training";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import EmptyState from "@/components/ui/empty-state";
import ErrorState from "@/components/ui/error-state";
import LoadingSkeleton from "@/components/ui/loading-skeleton";
import Pagination from "@/components/ui/pagination";
import TableScroll from "@/components/ui/table-scroll";
import { formatDateTime } from "@/utils/date";
import { recordDurationMinutes } from "@/utils/duration";
import { CLASS_TAB_PARAMS, RECORD_STATUS_OPTIONS } from "./class-workspace-tabs";

const LIMIT = 20;

const STATUS_LABEL: Record<string, string> = {
	completed: "已完成",
	abandoned: "已放弃",
	in_progress: "进行中",
};

function statusColor(status: string): string {
	if (status === "completed") return "green";
	if (status === "abandoned") return "gray";
	return "blue";
}

interface RecordsTabProps {
	classId: number;
	offset: number;
	status: string;
	onParamsChange: (updates: Array<[string, string]>) => void;
}

/**
 * 训练记录页签 —— 本班学生的真实练习记录（学生 / 病例 / 状态 / 得分 / 用时），
 * 行内下钻记录详情、姓名下钻学生学习档案。
 *
 * 只列**学生练习**（`only_student_practice: true`）：教师自己试跑的记录不属于班级教学数据。
 */
export default function ClassRecordsTab({
	classId,
	offset,
	status,
	onParamsChange,
}: RecordsTabProps) {
	const navigate = useNavigate();
	const keys = CLASS_TAB_PARAMS.records;

	const params: GetRecordsParams = {
		class_id: classId,
		only_student_practice: true,
		offset,
		limit: LIMIT,
		...(status ? { status } : {}),
	};

	const { data, isLoading, isError, error, refetch } = useQuery({
		queryKey: queryKeys.training.records(params),
		queryFn: () => getRecords(params).then((r) => r.data),
		staleTime: 60_000,
	});

	const items = data?.items ?? [];
	const total = data?.total ?? 0;

	return (
		<Card>
			<CardHeader>
				<Box
					style={{
						display: "flex",
						flexWrap: "wrap",
						gap: 8,
						alignItems: "center",
						justifyContent: "space-between",
					}}
				>
					<Group gap={8} wrap="nowrap">
						<IconFileText size={16} />
						<Text component="span" size="md" fw={600} lh={1.35}>
							训练记录
						</Text>
					</Group>
					<Group gap={8} wrap="wrap" align="center">
						<Text size="xs" c="dimmed" className="tabular-nums">
							{isError ? "—" : `共 ${total} 条`}
						</Text>
						{/* 用原生 select：三四个状态不值得一个门控下拉（键盘/读屏/移动端都直接可用） */}
						<select
							aria-label="按状态筛选训练记录"
							value={status}
							onChange={(e) => {
								// 状态一改就回第一页：否则会停在过滤后的空页
								onParamsChange([
									[keys.status, e.currentTarget.value],
									[keys.offset, ""],
								]);
							}}
							style={{
								fontSize: 12,
								padding: "4px 6px",
								borderRadius: 4,
								border: "1px solid var(--mantine-color-default-border)",
								background: "var(--mantine-color-body)",
								color: "inherit",
							}}
						>
							{RECORD_STATUS_OPTIONS.map((o) => (
								<option key={o.value} value={o.value}>
									{o.label}
								</option>
							))}
						</select>
					</Group>
				</Box>
			</CardHeader>
			<CardContent>
				{isError ? (
					<ErrorState
						title="训练记录加载失败"
						error={error}
						onRetry={() => refetch()}
					/>
				) : isLoading ? (
					<LoadingSkeleton variant="spinner" message="加载训练记录中…" />
				) : items.length === 0 ? (
					<EmptyState
						icon={IconFileText}
						title={status ? "没有符合该状态的记录" : "本班暂无训练记录"}
						description={
							status
								? "换个状态筛选看看，或清除筛选查看全部记录"
								: "学生完成练习后，记录会连同得分与用出现在这里"
						}
						action={
							status ? (
								<Button
									size="xs"
									variant="default"
									onClick={() =>
										onParamsChange([
											[keys.status, ""],
											[keys.offset, ""],
										])
									}
								>
									清除筛选
								</Button>
							) : undefined
						}
					/>
				) : (
					<>
						<TableScroll minWidth={760}>
							<Table highlightOnHover verticalSpacing="sm">
								<Table.Thead>
									<Table.Tr>
										<Table.Th style={{ minWidth: 130 }}>学生</Table.Th>
										<Table.Th style={{ minWidth: 160 }}>病例</Table.Th>
										<Table.Th style={{ width: 88, whiteSpace: "nowrap" }}>状态</Table.Th>
										<Table.Th style={{ width: 88, whiteSpace: "nowrap" }}>得分</Table.Th>
										<Table.Th style={{ width: 84, whiteSpace: "nowrap" }}>用时</Table.Th>
										<Table.Th style={{ minWidth: 140, whiteSpace: "nowrap" }}>
											开始时间
										</Table.Th>
									</Table.Tr>
								</Table.Thead>
								<Table.Tbody>
									{items.map((r) => {
										const durMins = recordDurationMinutes(r);
										return (
											<Table.Tr
												key={r.id}
												style={{ cursor: "pointer" }}
												onClick={() => navigate(`/admin/records/${r.id}`)}
											>
												<Table.Td>
													{/* 姓名下钻学生学习档案；行其余部分下钻记录详情 */}
													<Text
														component={Link}
														to={`/admin/students/${r.user_id}`}
														size="sm"
														fw={500}
														c="brand"
														onClick={(e) => e.stopPropagation()}
														style={{ wordBreak: "break-word" }}
													>
														{r.user_display_name}
													</Text>
													{r.user_student_id && (
														<Text size="xs" c="dimmed" className="tabular-nums">
															学号 {r.user_student_id}
														</Text>
													)}
												</Table.Td>
												<Table.Td>
													<Text
														size="sm"
														component="a"
														href={`/admin/records/${r.id}`}
														onClick={(e) => {
															e.preventDefault();
															navigate(`/admin/records/${r.id}`);
														}}
														style={{ wordBreak: "break-word" }}
													>
														{r.case_name}
													</Text>
													{r.assignment_title && (
														<Text size="xs" c="dimmed">
															作业：{r.assignment_title}
														</Text>
													)}
												</Table.Td>
												<Table.Td>
													<Badge variant="light" color={statusColor(r.status)} size="sm">
														{STATUS_LABEL[r.status] ?? r.status}
													</Badge>
												</Table.Td>
												<Table.Td>
													{r.score_total != null ? (
														<Text component="span" size="sm" fw={600} c="blue" className="tabular-nums">
															{r.score_total}分
														</Text>
													) : r.scoring_status === "pending" ||
														r.scoring_status === "processing" ? (
														<Badge variant="light" color="yellow" size="sm">
															评分中
														</Badge>
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
														<Text component="span" size="sm" c="dimmed">
															—
														</Text>
													)}
												</Table.Td>
												<Table.Td>
													<Text size="xs" c="dimmed" className="tabular-nums">
														{durMins != null ? `${durMins} 分钟` : "进行中"}
													</Text>
												</Table.Td>
												<Table.Td>
													<Text size="xs" c="dimmed" className="tabular-nums">
														{formatDateTime(r.start_time) || "—"}
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
									onChange={(next) => onParamsChange([[keys.offset, next > 0 ? String(next) : ""]])}
								/>
							</Stack>
						)}
					</>
				)}
			</CardContent>
		</Card>
	);
}
