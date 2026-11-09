import { Badge, Button, Group, SegmentedControl, Table, Text } from "@mantine/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { IconArrowRight, IconClipboardCheck } from "@tabler/icons-react";
import { useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getRecords, submitScoreReview } from "@/api";
import type { GetRecordsParams } from "@/api";
import { queryKeys } from "@/api/query-keys";
import { getRecordReview, recordReviewQueryKey } from "@/api/training-review";
import ClassFilter, { type ClassFilterParams } from "@/components/admin/ClassFilter";
import { ReviewEditor } from "@/components/record-review";
import type { RawReviewSubmitPayload } from "@/components/record-review/review-payload";
import { toast } from "@/components/Toast";
import EmptyState from "@/components/ui/empty-state";
import ErrorState from "@/components/ui/error-state";
import { FilterToolbar } from "@/components/ui/filter-toolbar";
import ListPage from "@/components/ui/list-page";
import LoadingSkeleton from "@/components/ui/loading-skeleton";
import PageHeader from "@/components/ui/page-header";
import Pagination from "@/components/ui/pagination";
import { SearchInput } from "@/components/ui/search-input";
import TableScroll from "@/components/ui/table-scroll";
import { useListFilters } from "@/hooks/useListFilters";
import { formatDateTime } from "@/utils/date";
import { nextPendingId } from "./review-queue";

const LIMIT = 20;

const INITIAL_FILTERS: GetRecordsParams = {
	review_status: "pending",
	only_student_practice: true,
};

/**
 * 教师批改工作台：在**一页内**连续批改多份结果。
 *
 * 列表与复核都复用既有接口（`GET /training/records` + `GET /training/records/{id}/review`），
 * 这里只负责"选下一份"的流程：提交后自动前进到队列里下一条未复核记录，
 * 不再「进详情 → 批改 → 返回列表 → 再点下一条」。
 */
export default function ReviewWorkbench() {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const list = useListFilters<GetRecordsParams>(INITIAL_FILTERS, {
		limit: LIMIT,
		searchKey: "student_name",
		urlSync: true,
	});
	const [activeId, setActiveId] = useState<number | null>(null);
	const [submitting, setSubmitting] = useState(false);

	const { data, isLoading, isError, error, refetch } = useQuery({
		queryKey: queryKeys.training.records(list.params),
		queryFn: () => getRecords(list.params).then((r) => r.data),
		staleTime: 30_000,
	});
	const records = data?.items ?? [];
	const total = data?.total ?? 0;

	const {
		data: reviewData,
		isLoading: reviewLoading,
		isError: reviewLoadError,
		refetch: refetchReview,
	} = useQuery({
		queryKey: recordReviewQueryKey(activeId ?? 0),
		queryFn: () => getRecordReview(activeId as number).then((r) => r.data),
		enabled: activeId != null,
		staleTime: 0,
	});

	const handleClassFilterChange = useCallback(
		(params: ClassFilterParams) => {
			list.setFilter("class_id", params.class_id ?? undefined);
		},
		[list],
	);

	const submit = async (payload: RawReviewSubmitPayload, comment: string, advance: boolean) => {
		if (activeId == null) return;
		setSubmitting(true);
		try {
			await submitScoreReview(activeId, { detail_scores: payload, comment });
			await queryClient.invalidateQueries({ queryKey: queryKeys.training.all });
			if (!advance) {
				toast.success("复核已提交");
				setActiveId(null);
				return;
			}
			const next = nextPendingId(records, activeId);
			if (next == null) {
				toast.success("本页待批改已全部完成");
				setActiveId(null);
			} else {
				toast.success("已提交，进入下一份");
				setActiveId(next);
			}
		} catch (e) {
			toast.apiError(e, "提交失败");
		} finally {
			setSubmitting(false);
		}
	};

	return (
		<ListPage
			header={
				<PageHeader
					title="批改工作台"
					subtitle="连续批改多份结果：提交后自动进入下一份未复核记录"
					icon={IconClipboardCheck}
				/>
			}
			toolbar={
				<FilterToolbar
				summary={total > 0 ? `共 ${total} 份${list.values.review_status === "reviewed" ? "已复核" : "待批改"}` : undefined}
				hasActiveFilters={list.hasActiveFilters}
				onClear={list.reset}
				search={
					<SearchInput
						value={list.searchInput}
						onChange={list.onSearchChange}
						placeholder="搜索学生姓名..."
					/>
				}
				filters={
					<>
						<SegmentedControl
							size="xs"
							value={list.values.review_status ?? "pending"}
							onChange={(v) => list.setFilter("review_status", v)}
							data={[
								{ value: "pending", label: "待批改" },
								{ value: "reviewed", label: "已批改" },
							]}
						/>
						<ClassFilter onChange={handleClassFilterChange} classId={list.values.class_id} />
					</>
				}
				/>
			}
			footer={
				total > 0 ? (
					<Pagination total={total} offset={list.offset} limit={LIMIT} onChange={list.setOffset} />
				) : undefined
			}
		>
			{isLoading ? (
				<LoadingSkeleton variant="table" />
			) : isError ? (
				<ErrorState error={error} onRetry={() => refetch()} />
			) : records.length === 0 ? (
				<EmptyState
					title={list.values.review_status === "reviewed" ? "暂无已批改记录" : "没有待批改的记录"}
					description={
						list.values.review_status === "reviewed"
							? "切到「待批改」查看需要处理的评分"
							: "学生完成训练并评分后会出现在这里"
					}
				/>
			) : (
				<TableScroll minWidth={720}>
						<Table striped highlightOnHover>
							<Table.Thead>
								<Table.Tr>
									<Table.Th>学生</Table.Th>
									<Table.Th>病例</Table.Th>
									<Table.Th>得分</Table.Th>
									<Table.Th>完成时间</Table.Th>
									<Table.Th>状态</Table.Th>
									<Table.Th />
								</Table.Tr>
							</Table.Thead>
							<Table.Tbody>
								{records.map((r) => (
									<Table.Tr key={r.id}>
										<Table.Td>
											<Text size="sm" fw={500}>{r.user_display_name}</Text>
											{r.user_student_id && (
												<Text size="xs" c="dimmed">{r.user_student_id}</Text>
											)}
										</Table.Td>
										<Table.Td>{r.case_name}</Table.Td>
										<Table.Td style={{ fontVariantNumeric: "tabular-nums" }}>
											{r.score_total != null ? `${r.score_total}分` : "—"}
										</Table.Td>
										<Table.Td>
											<Text size="sm" c="dimmed">
												{r.end_time ? formatDateTime(r.end_time) : "—"}
											</Text>
										</Table.Td>
										<Table.Td>
											<Group gap={6}>
												<Badge size="sm" variant="light" color={r.score_reviewed ? "green" : "orange"}>
													{r.score_reviewed ? "已复核" : "待复核"}
												</Badge>
												{r.scoring_status === "failed" && (
													<Badge size="sm" variant="light" color="red">评分失败</Badge>
												)}
											</Group>
										</Table.Td>
										<Table.Td>
											<Group gap="xs" justify="flex-end" wrap="nowrap">
												<Button
													variant="subtle"
													size="xs"
													onClick={() => navigate(`/admin/records/${r.id}`)}
												>
													详情
												</Button>
												<Button
													size="xs"
													variant="light"
													rightSection={<IconArrowRight size={14} />}
													onClick={() => setActiveId(r.id)}
												>
													{r.score_reviewed ? "重批" : "批改"}
												</Button>
											</Group>
										</Table.Td>
									</Table.Tr>
								))}
							</Table.Tbody>
						</Table>
				</TableScroll>
			)}

			{activeId != null && (
				<ReviewEditor
					key={activeId}
					review={reviewData ?? null}
					loading={reviewLoading}
					loadError={reviewLoadError}
					onReload={() => refetchReview()}
					scoreMax={reviewData?.display_max ?? 100}
					onSubmit={(payload, comment) => submit(payload, comment, false)}
					onSubmitAndNext={(payload, comment) => submit(payload, comment, true)}
					onClose={() => setActiveId(null)}
					submitting={submitting}
				/>
			)}
		</ListPage>
	);
}
