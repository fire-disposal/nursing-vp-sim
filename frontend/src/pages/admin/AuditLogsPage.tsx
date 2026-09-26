import { Badge, Box, Code, Paper, Select, Text, Tooltip } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { getAuditLogs, type AuditLogItem } from "@/api/admin/audit-logs";
import type { AuditLogParams } from "@/api/query-params";
import { queryKeys } from "@/api/query-keys";
import DataTable, { type DataTableColumn } from "@/components/ui/data-table";
import ExportButton from "@/components/ExportButton";
import { FilterToolbar } from "@/components/ui/filter-toolbar";
import PageHeader from "@/components/ui/page-header";
import { SearchInput } from "@/components/ui/search-input";
import { useListFilters } from "@/hooks/useListFilters";

const LIMIT = 50;

/** 动作 → 中文（未列出的直接显示原始键，避免漏一个就显示空白）。 */
const ACTION_LABELS: Record<string, string> = {
	"role.created": "新建角色",
	"role.updated": "修改角色权限",
	"role.deleted": "删除角色",
	"user.created": "新建账号",
	"user.updated": "修改用户",
	"user.deactivated": "停用账号",
	"user.activated": "启用账号",
	"user.deleted": "删除账号",
	"user.password_reset": "重置密码",
	"user.bulk_imported": "批量导入",
	"user.bulk_assigned": "批量分班",
	"secret.created": "新增密钥",
	"secret.updated": "修改密钥",
	"secret.deleted": "删除密钥",
	"export.downloaded": "导出数据",
	"access.denied": "越权被拒",
};

const OUTCOME_META: Record<string, { label: string; color: string }> = {
	success: { label: "成功", color: "green" },
	denied: { label: "被拒绝", color: "orange" },
	failure: { label: "失败", color: "red" },
};

const TARGET_LABELS: Record<string, string> = {
	user: "用户",
	role: "角色",
	class: "班级",
	secret: "密钥",
	export: "导出",
	case: "病例",
	score: "评分",
};

function fmtTime(value: string | null): string {
	if (!value) return "—";
	const d = new Date(value);
	return Number.isNaN(d.getTime()) ? value : d.toLocaleString("zh-CN", { hour12: false });
}

/**
 * 审计日志页（`audit_view` / `audit_export`）。
 *
 * 沿用本仓列表约定：筛选态由 useListFilters 持有 → params 与 exportParams 同源，
 * 导出按钮因此不会漏筛（见 ui-improvement-plan §6.4）。
 */
export default function AuditLogsPage() {
	const list = useListFilters<AuditLogParams>(
		{ actor_id: undefined, action: "", target_type: "", outcome: "", date_from: "", date_to: "", search: "" },
		{ limit: LIMIT, searchKey: "search" },
	);

	const { data, isLoading } = useQuery({
		queryKey: queryKeys.admin.auditLogs.list(list.params),
		queryFn: () => getAuditLogs(list.params).then((r) => r.data),
		placeholderData: (prev) => prev,
		staleTime: 30_000,
	});

	const items = data?.items ?? [];
	const total = data?.total ?? 0;

	const columns = useMemo<DataTableColumn<AuditLogItem>[]>(
		() => [
			{
				key: "created_at",
				header: "时间",
				render: (r) => (
					<Text size="xs" c="dimmed" style={{ fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
						{fmtTime(r.created_at)}
					</Text>
				),
			},
			{
				key: "actor",
				header: "操作者",
				render: (r) =>
					r.actor_username ? (
						<Box>
							<Text size="sm">{r.actor_display_name || r.actor_username}</Text>
							<Text size="xs" c="dimmed">
								{r.actor_username}
								{r.actor_role ? ` · ${r.actor_role}` : ""}
								{r.actor_id === null ? "（账号已删除）" : ""}
							</Text>
						</Box>
					) : (
						<Text size="xs" c="dimmed">
							匿名 / 系统
						</Text>
					),
			},
			{
				key: "action",
				header: "动作",
				render: (r) => <Text size="sm">{ACTION_LABELS[r.action] ?? r.action}</Text>,
			},
			{
				key: "target",
				header: "对象",
				render: (r) => (
					<Box>
						<Text size="sm">{r.target_label || r.target_id || "—"}</Text>
						<Text size="xs" c="dimmed">
							{TARGET_LABELS[r.target_type] ?? r.target_type}
						</Text>
					</Box>
				),
			},
			{
				key: "outcome",
				header: "结果",
				render: (r) => {
					const meta = OUTCOME_META[r.outcome] ?? { label: r.outcome, color: "gray" };
					return (
						<Badge variant="light" color={meta.color}>
							{meta.label}
						</Badge>
					);
				},
			},
			{
				key: "detail",
				header: "详情",
				render: (r) => {
					const detail = JSON.stringify(r.payload ?? {});
					if (!detail || detail === "{}") {
						return (
							<Text size="xs" c="dimmed">
								—
							</Text>
						);
					}
					return (
						<Tooltip label={detail} multiline maw={420} openDelay={200}>
							<Code
								style={{
									display: "inline-block",
									maxWidth: 260,
									overflow: "hidden",
									textOverflow: "ellipsis",
									whiteSpace: "nowrap",
									verticalAlign: "middle",
								}}
							>
								{detail}
							</Code>
						</Tooltip>
					);
				},
			},
			{
				key: "request",
				header: "请求",
				render: (r) => (
					<Box>
						<Text size="xs" c="dimmed" style={{ whiteSpace: "nowrap" }}>
							{r.ip || "—"}
						</Text>
						{r.request_id && (
							<Text size="xs" c="dimmed" style={{ fontFamily: "var(--mantine-font-family-monospace)" }}>
								{r.request_id.slice(0, 8)}
							</Text>
						)}
					</Box>
				),
			},
		],
		[],
	);

	return (
		<>
			<PageHeader
				title="审计日志"
				subtitle="谁、在什么时候、对什么对象做了什么；只追加，不提供修改与删除"
				actions={
					<ExportButton
						endpoint="/admin/audit-logs/export"
						filename="审计日志"
						params={list.exportParams}
					/>
				}
			/>

			<FilterToolbar
				compact
				summary={`共 ${total} 条`}
				hasActiveFilters={list.hasActiveFilters}
				onClear={list.reset}
				search={
					<SearchInput
						value={list.searchInput}
						onChange={list.onSearchChange}
						placeholder="操作者 / 对象 / 路径..."
					/>
				}
				filters={
					<>
						<Select
							size="sm"
							clearable
							w={150}
							placeholder="全部动作"
							value={list.values.action || null}
							onChange={(v) => list.setFilter("action", v ?? "")}
							searchable
							data={Object.entries(ACTION_LABELS).map(([value, label]) => ({ value, label }))}
						/>
						<Select
							size="sm"
							clearable
							w={120}
							placeholder="全部对象"
							value={list.values.target_type || null}
							onChange={(v) => list.setFilter("target_type", v ?? "")}
							data={Object.entries(TARGET_LABELS).map(([value, label]) => ({ value, label }))}
						/>
						<Select
							size="sm"
							clearable
							w={110}
							placeholder="全部结果"
							value={list.values.outcome || null}
							onChange={(v) => list.setFilter("outcome", v ?? "")}
							data={Object.entries(OUTCOME_META).map(([value, meta]) => ({ value, label: meta.label }))}
						/>
					</>
				}
			/>

			<Paper withBorder style={{ overflow: "hidden" }}>
				<DataTable
					columns={columns}
					rows={items}
					rowKey={(r) => r.id}
					loading={isLoading}
					stickyHeader
					bare
					total={total}
					offset={list.offset}
					limit={LIMIT}
					onOffsetChange={list.setOffset}
					emptyTitle="暂无审计记录"
					emptyDescription="接入后发生的高风险操作会出现在这里"
				/>
			</Paper>

		</>
	);
}
