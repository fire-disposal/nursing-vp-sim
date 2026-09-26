import { IconAlertCircle, IconArchive, IconPencil, IconPlus, IconRefresh, IconRocket, IconSearch, IconTrash, IconWand, IconX } from "@tabler/icons-react";
import { ActionIcon, Alert, Badge, Box, Button, Group, Loader, Paper, Select, Stack, Switch, Table, Text, TextInput } from "@mantine/core";
import Pagination from "@/components/ui/pagination";
import { ACTIVITY_LABELS } from "@/config/activity-display";
import type { components } from "@/api/api-types.gen";
import { CaseStatusBadge } from "./CaseStatusBadge";
import { CASE_STATUS_FILTER_OPTIONS } from "./caseStatus";

type CaseManageItem = components["schemas"]["CaseManageItem"];

/** 病例库筛选条件（CasesTab 持有状态，列表只做展示与回调）。 */
export interface CaseListFilters {
	name: string;
	difficulty: string;
	/** 生命周期："" = 全部（不含归档）/ draft / published / archived */
	status: string;
	is_open: string;
}

interface CaseListProps {
	cases: CaseManageItem[];
	total: number;
	offset: number;
	limit: number;
	filters: CaseListFilters;
	searchInput: string;
	loading?: boolean;
	error?: boolean;
	/** 正在发布/归档/删除的病例 id（行内 pending）。 */
	pendingId?: number | null;
	onSearchChange: (value: string) => void;
	onFilterChange: (filters: CaseListFilters) => void;
	onOffsetChange: (offset: number) => void;
	onRetry?: () => void;
	onAdd: () => void;
	onAIAdd: () => void;
	onEdit: (c: CaseManageItem) => void;
	onDelete: (c: CaseManageItem) => void;
	onToggleOpen: (c: CaseManageItem) => void;
	onPublish: (c: CaseManageItem) => void;
	onArchive: (c: CaseManageItem) => void;
}

const DIFFICULTY_LABELS: Record<number, string> = { 1: "初级", 2: "中级", 3: "高级" };

function CapabilityBadges({ caps }: { caps: Record<string, boolean> | undefined }) {
	if (!caps) return null;
	const enabled = Object.entries(ACTIVITY_LABELS).filter(([key]) => caps[key]);
	if (enabled.length === 0) return <Text size="xs" c="dimmed" opacity={0.4}>—</Text>;
	return (
		<Group gap={4}>
			{enabled.map(([key, label]) => (
				<Badge key={key} variant="light" color="gray" size="xs">{label}</Badge>
			))}
		</Group>
	);
}

export default function CaseList({
	cases, total, offset, limit,
	filters, searchInput, loading, error, pendingId,
	onSearchChange, onFilterChange, onOffsetChange, onRetry,
	onAdd, onAIAdd, onEdit, onDelete, onToggleOpen, onPublish, onArchive,
}: CaseListProps) {
	const hasFilters = Boolean(filters.name || filters.difficulty || filters.status || filters.is_open);

	return (
		<Stack gap="md">
			{/* Toolbar */}
			<Group gap={8}>
				<Button size="sm" onClick={onAdd} leftSection={<IconPlus size={14} />}>新建病例</Button>
				<Button size="sm" variant="outline" onClick={onAIAdd} leftSection={<IconWand size={14} />}>AI 生成</Button>
				<div style={{ flex: 1 }} />
				<TextInput
					size="xs"
					w={180}
					value={searchInput}
					onChange={(e) => onSearchChange(e.currentTarget.value)}
					placeholder="搜索病例…"
					leftSection={<IconSearch size={14} />}
					rightSection={
						searchInput ? (
							<ActionIcon variant="subtle" color="gray" size="xs" onClick={() => onSearchChange("")} aria-label="清除搜索">
								<IconX size={12} />
							</ActionIcon>
						) : undefined
					}
				/>
			</Group>

			<Group gap={8} wrap="wrap">
				<Box w={130}>
					<Select
						data={[...CASE_STATUS_FILTER_OPTIONS]}
						value={filters.status || "all"}
						onChange={(v) => onFilterChange({ ...filters, status: v === "all" ? "" : v ?? "" })}
						placeholder="全部状态"
						size="xs"
						allowDeselect={false}
						aria-label="按生命周期筛选"
					/>
				</Box>
				<Box w={110}>
					<Select
						data={[{ value: "all", label: "全部难度" }, { value: "1", label: "初级" }, { value: "2", label: "中级" }, { value: "3", label: "高级" }]}
						value={filters.difficulty || "all"}
						onChange={(v) => onFilterChange({ ...filters, difficulty: v === "all" ? "" : v ?? "" })}
						placeholder="全部难度"
						size="xs"
						allowDeselect={false}
						aria-label="按难度筛选"
					/>
				</Box>
				<Box w={110}>
					<Select
						data={[{ value: "all", label: "全部可见" }, { value: "true", label: "已开放" }, { value: "false", label: "未开放" }]}
						value={filters.is_open || "all"}
						onChange={(v) => onFilterChange({ ...filters, is_open: v === "all" ? "" : v ?? "" })}
						placeholder="全部可见"
						size="xs"
						allowDeselect={false}
						aria-label="按学生可见筛选"
					/>
				</Box>
			</Group>

			{error && (
				<Alert variant="light" color="red" icon={<IconAlertCircle size={16} />}>
					<Group justify="space-between" gap={8} wrap="wrap">
						<Text size="sm">加载病例列表失败，请检查网络后重试。</Text>
						{onRetry && (
							<Button size="xs" variant="outline" color="red" leftSection={<IconRefresh size={13} />} onClick={onRetry}>
								重试
							</Button>
						)}
					</Group>
				</Alert>
			)}

			{/* Table */}
			<Paper withBorder style={{ overflow: "auto" }}>
				<Table highlightOnHover miw={720} horizontalSpacing="sm" verticalSpacing="xs">
					<Table.Thead>
						<Table.Tr>
							<Table.Th><Text size="xs" c="dimmed" fw={600}>病例名称</Text></Table.Th>
							<Table.Th><Text size="xs" c="dimmed" fw={600}>难度</Text></Table.Th>
							<Table.Th><Text size="xs" c="dimmed" fw={600}>能力</Text></Table.Th>
							<Table.Th><Text size="xs" c="dimmed" fw={600}>状态</Text></Table.Th>
							<Table.Th style={{ textAlign: "center" }}><Text size="xs" c="dimmed" fw={600}>学生可见</Text></Table.Th>
							<Table.Th style={{ textAlign: "center" }}><Text size="xs" c="dimmed" fw={600}>操作</Text></Table.Th>
						</Table.Tr>
					</Table.Thead>
					<Table.Tbody>
						{cases.length === 0 && (
							<Table.Tr>
								<Table.Td colSpan={6}>
									{loading ? (
										<Group justify="center" gap={8} py="lg">
											<Loader size={16} />
											<Text size="sm" c="dimmed">加载中…</Text>
										</Group>
									) : (
										<Stack align="center" gap={4} py="lg">
											<Text size="sm" c="dimmed">{hasFilters ? "没有符合条件的病例" : "尚未创建病例"}</Text>
											<Text size="xs" c="dimmed">
												{hasFilters ? "试试放宽筛选条件" : "新建的病例是草稿，编辑完成后「发布」才能用于作业与训练"}
											</Text>
										</Stack>
									)}
								</Table.Td>
							</Table.Tr>
						)}
						{cases.map((c) => {
							const published = c.status === "published";
							const archived = c.status === "archived";
							const busy = pendingId === c.id;
							return (
								<Table.Tr key={c.id}>
									<Table.Td>
										<Text size="xs" fw={500} truncate>{c.name}</Text>
										<Text size="xs" c="dimmed" truncate mt={2}>
											{[c.patient_gender, c.patient_age != null ? `${c.patient_age}岁` : null].filter(Boolean).join(" · ")}
										</Text>
									</Table.Td>
									<Table.Td><Text size="xs">{DIFFICULTY_LABELS[c.difficulty ?? 1]}</Text></Table.Td>
									<Table.Td><CapabilityBadges caps={c.capabilities} /></Table.Td>
									<Table.Td>
										<CaseStatusBadge status={c.status} revisionNo={c.current_revision_no} />
									</Table.Td>
									<Table.Td style={{ textAlign: "center" }}>
										{published ? (
											<Switch
												size="xs"
												checked={c.is_open}
												onChange={() => onToggleOpen(c)}
												disabled={busy}
												aria-label={`学生可见 ${c.name}`}
											/>
										) : (
											<Text size="xs" c="dimmed">
												{archived ? "不可用" : "待发布"}
											</Text>
										)}
									</Table.Td>
									<Table.Td>
										<Group gap={4} justify="center" wrap="nowrap">
											<ActionIcon
												variant="subtle"
												color="gray"
												size="sm"
												onClick={() => onEdit(c)}
												aria-label="编辑"
												title={archived ? "已归档病例内容冻结，不可编辑" : "编辑"}
												disabled={archived}
											>
												<IconPencil size={14} />
											</ActionIcon>
											{!published && !archived && (
												<ActionIcon
													variant="subtle"
													color="green"
													size="sm"
													onClick={() => onPublish(c)}
													aria-label="发布"
													title="发布（先过发布门禁）"
													loading={busy}
												>
													<IconRocket size={14} />
												</ActionIcon>
											)}
											{!archived && (
												<ActionIcon
													variant="subtle"
													color="orange"
													size="sm"
													onClick={() => onArchive(c)}
													aria-label="归档"
													title="归档（不再用于新作业与训练，历史训练保留）"
													disabled={busy}
												>
													<IconArchive size={14} />
												</ActionIcon>
											)}
											<ActionIcon
												variant="subtle"
												color="red"
												size="sm"
												onClick={() => onDelete(c)}
												aria-label="删除"
												title="删除"
												disabled={busy}
											>
												<IconTrash size={14} />
											</ActionIcon>
										</Group>
									</Table.Td>
								</Table.Tr>
							);
						})}
					</Table.Tbody>
				</Table>
			</Paper>

			{total > limit && <Pagination total={total} offset={offset} limit={limit} onChange={onOffsetChange} />}
		</Stack>
	);
}
