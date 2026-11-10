import { Anchor, Badge, Select, Text } from "@mantine/core";
import { IconClipboardList } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { queryKeys } from "@/api/query-keys";
import {
	getQuestionnaireResponses,
	getQuestionnaireTemplate,
	type QuestionnaireResponseItem,
} from "@/api/questionnaires";
import {
	RESPONSE_STATUS_FILTER_OPTIONS,
	RESPONSE_STATUS_LABEL,
	TRIGGER_EVENT_FILTER_OPTIONS,
	TRIGGER_EVENT_LABEL,
} from "@/components/admin/questionnaires/types";
import DataTable, { type DataTableColumn } from "@/components/ui/data-table";
import ErrorState from "@/components/ui/error-state";
import { FilterToolbar } from "@/components/ui/filter-toolbar";
import ListPage from "@/components/ui/list-page";
import PageHeader from "@/components/ui/page-header";
import Pagination from "@/components/ui/pagination";
import { SearchInput } from "@/components/ui/search-input";
import { useListFilters } from "@/hooks/useListFilters";
import { formatDateTime } from "@/utils/date";

const LIMIT = 20;

interface ResponseFilters extends Record<string, unknown> {
	status: string;
	trigger_event: string;
	search: string;
}

/**
 * `/admin/questionnaires/:id/responses`
 *
 * 逐份答卷列表。分页与筛选都在服务端（`total` 是收窄后的真实条数），
 * 收窄口径由后端按院校/任教班完成——前端不拿"列表条数"当权限判断。
 */
export default function QuestionnaireResponsesPage() {
	const { id } = useParams<{ id: string }>();
	const templateId = Number(id);
	const valid = Number.isInteger(templateId) && templateId > 0;

	const list = useListFilters<ResponseFilters>(
		{ status: "completed", trigger_event: "", search: "" },
		{ limit: LIMIT, searchKey: "search", urlSync: true },
	);

	const {
		data: template,
		isError: templateError,
		error: templateErrorObj,
		refetch: refetchTemplate,
	} = useQuery({
		queryKey: queryKeys.questionnaires.detail(valid ? templateId : null),
		queryFn: () => getQuestionnaireTemplate(templateId).then((r) => r.data),
		enabled: valid,
		staleTime: 5 * 60_000,
	});

	const { data, isLoading, isError, error, refetch } = useQuery({
		queryKey: queryKeys.questionnaires.responses(valid ? templateId : null, list.params),
		queryFn: () =>
			getQuestionnaireResponses(templateId, {
				...list.params,
				offset: list.offset,
				limit: LIMIT,
			}).then((r) => r.data),
		enabled: valid,
		placeholderData: (prev) => prev,
		staleTime: 60_000,
	});

	const rows: QuestionnaireResponseItem[] = data?.items ?? [];
	const total = data?.total ?? 0;

	const columns: DataTableColumn<QuestionnaireResponseItem>[] = [
		{
			key: "user_name",
			header: "作答人",
			cellClassName: "font-medium",
			render: (r) => (
				<Anchor
					component={Link}
					to={`/admin/questionnaires/${templateId}/responses/${r.id}`}
					size="sm"
					fw={500}
				>
					{r.user_name || `用户 #${r.user_id}`}
				</Anchor>
			),
		},
		{
			key: "trigger_event",
			header: "触发时点",
			render: (r) => (
				<Badge variant="light" color={r.trigger_event === "after_scoring" ? "grape" : "blue"}>
					{TRIGGER_EVENT_LABEL[r.trigger_event] ?? r.trigger_event}
				</Badge>
			),
		},
		{
			key: "status",
			header: "状态",
			render: (r) => (
				<Badge variant="light" color={r.status === "completed" ? "green" : "gray"}>
					{RESPONSE_STATUS_LABEL[r.status] ?? r.status}
				</Badge>
			),
		},
		{
			key: "case_name",
			header: "病例",
			render: (r) =>
				r.case_name ? (
					<Text size="sm" truncate style={{ maxWidth: 180 }}>
						{r.case_name}
					</Text>
				) : (
					<Text size="sm" c="dimmed">
						—
					</Text>
				),
		},
		{
			key: "submitted",
			header: "提交时间",
			render: (r) =>
				r.completed_at ? (
					<Text size="sm" className="tabular-nums">
						{formatDateTime(r.completed_at)}
					</Text>
				) : (
					<Text size="sm" c="dimmed">
						未提交
					</Text>
				),
		},
		{
			key: "record",
			header: "关联训练",
			render: (r) =>
				// 只有真实 record id 才给入口：编造一条链接会把人带到别人的记录或 404
				r.record_id ? (
					<Anchor
						component={Link}
						to={`/admin/records/${r.record_id}`}
						size="sm"
						data-testid={`record-link-${r.id}`}
					>
						{`#${r.record_id}`}
					</Anchor>
				) : (
					<Text size="sm" c="dimmed">
						—
					</Text>
				),
		},
	];

	return (
		<ListPage
			header={
				<PageHeader
					title={template ? `${template.title} · 答卷` : "问卷答卷"}
					subtitle="逐份查看学生作答；打开姓名进入详情"
					icon={IconClipboardList}
					backTo="/admin/questionnaires"
				/>
			}
			toolbar={
				<FilterToolbar
					compact
					summary={templateError || isError ? "共 — 份" : `共 ${total} 份`}
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
							<Select
								size="sm"
								aria-label="提交状态"
								data={RESPONSE_STATUS_FILTER_OPTIONS}
								value={list.values.status || null}
								onChange={(v) => list.setFilter("status", v ?? "")}
								w={120}
							/>
							<Select
								size="sm"
								aria-label="触发时点"
								data={TRIGGER_EVENT_FILTER_OPTIONS}
								value={list.values.trigger_event || null}
								onChange={(v) => list.setFilter("trigger_event", v ?? "")}
								w={130}
							/>
						</>
					}
				/>
			}
			footer={
				total > 0 ? (
					<Pagination
						total={total}
						offset={list.offset}
						limit={LIMIT}
						onChange={list.setOffset}
					/>
				) : undefined
			}
		>
			{!valid ? (
				<ErrorState
					title="问卷 ID 无效"
					description="地址栏里的问卷 ID 不是一个有效编号。"
				/>
			) : templateError ? (
				<ErrorState
					title="问卷不存在或无权访问"
					error={templateErrorObj}
					onRetry={() => void refetchTemplate()}
				/>
			) : isError ? (
				<ErrorState title="答卷加载失败" error={error} onRetry={() => void refetch()} />
			) : (
				<DataTable
					columns={columns}
					rows={rows}
					rowKey={(r) => r.id}
					loading={isLoading}
					emptyIcon={IconClipboardList as never}
					emptyTitle="暂无答卷"
					emptyDescription={
						list.hasActiveFilters
							? "当前筛选下没有答卷，试试清除筛选"
							: "该问卷还没有学生提交"
					}
					stickyHeader={false}
					bare
					minWidth={860}
				/>
			)}
		</ListPage>
	);
}
