import { Badge, Button, Group, Paper, Select, Text } from "@mantine/core";
import {
	IconChartBar,
	IconClipboardCheck,
	IconEdit,
	IconFileText,
	IconPlus,
	IconTrash,
} from "@tabler/icons-react";
import type { TemplateListItem } from "@/components/admin/questionnaires/types";
import { TYPE_LABEL, TYPE_OPTIONS } from "@/components/admin/questionnaires/types";
import DataTable, { type DataTableColumn } from "@/components/ui/data-table";
import { FilterToolbar } from "@/components/ui/filter-toolbar";
import { SearchInput } from "@/components/ui/search-input";

interface QuestionnaireListProps {
	templates: TemplateListItem[];
	isLoading: boolean;
	total: number;
	offset: number;
	limit: number;
	typeFilter: string;
	searchText: string;
	statusFilter: string;
	onOffsetChange: (offset: number) => void;
	onTypeFilterChange: (type: string) => void;
	hasActiveFilters: boolean;
	onClear: () => void;
	onSearchChange: (search: string) => void;
	onStatusFilterChange: (status: string) => void;
	onCreate: () => void;
	onEdit: (t: TemplateListItem) => void;
	onDelete: (t: TemplateListItem) => void;
	onAssign: (t: TemplateListItem) => void;
	onViewStats: (t: TemplateListItem) => void;
}

export default function QuestionnaireList({
	templates,
	isLoading,
	total,
	hasActiveFilters,
	onClear,
	offset,
	limit,
	typeFilter,
	searchText,
	statusFilter,
	onOffsetChange,
	onTypeFilterChange,
	onSearchChange,
	onStatusFilterChange,
	onCreate,
	onEdit,
	onDelete,
	onAssign,
	onViewStats,
}: QuestionnaireListProps) {
	const columns: DataTableColumn<TemplateListItem>[] = [
		{
			key: "title",
			header: "标题",
			cellClassName: "font-medium",
			render: (t) => (
				<>
					{t.title}
					{t.description && (
						<Text size="xs" c="dimmed" mt={2} truncate style={{ maxWidth: 300 }}>
							{t.description}
						</Text>
					)}
				</>
			),
		},
		{
			key: "type",
			header: "类型",
			render: (t) => (
				<Badge variant="light" color={t.type === "pre" ? "blue" : "green"}>
					{TYPE_LABEL[t.type] || t.type}
				</Badge>
			),
		},
		{
			key: "status",
			header: "状态",
			render: (t) => (
				<Badge variant="light" color={t.is_active ? "green" : "gray"}>
					{t.is_active ? "启用" : "禁用"}
				</Badge>
			),
		},
		{
			key: "question_count",
			header: "题目数",
			render: (t) => t.question_count,
		},
		{
			key: "response_count",
			header: "回收数",
			render: (t) => (
				<Text
					fw={500}
					c={t.response_count > 0 ? "blue" : "dimmed"}
					opacity={t.response_count > 0 ? 1 : 0.7}
				>
					{t.response_count}
				</Text>
			),
		},
		{
			key: "actions",
			header: "操作",
			render: (t) => (
				<Group gap={8} wrap="nowrap">
					<Button
						size="sm"
						variant="subtle"
						color="gray"
						onClick={() => onEdit(t)}
						title="编辑"
					>
						<IconEdit size={14} />
					</Button>
					<Button
						size="sm"
						variant="subtle"
						color="gray"
						onClick={() => onAssign(t)}
						title="分配病例"
					>
						<IconFileText size={14} />
					</Button>
					<Button
						size="sm"
						variant="subtle"
						color="gray"
						onClick={() => onViewStats(t)}
						title="查看数据"
					>
						<IconChartBar size={14} />
					</Button>
					<Button
						size="sm"
						variant="light"
						color="red"
						onClick={() => onDelete(t)}
						title="删除"
					>
						<IconTrash size={14} />
					</Button>
				</Group>
			),
		},
	];

	return (
		<>
			<Group mb="md">
				<Button onClick={onCreate}>
					<IconPlus size={16} /> 新建问卷
				</Button>
			</Group>

			<Paper withBorder shadow="sm" p="md">
				{/* 统一工具栏：计数 / 筛选 / 搜索 + 一键复位（与其余列表页同范式） */}
				<FilterToolbar
					compact
					summary={`共 ${total} 条`}
					hasActiveFilters={hasActiveFilters}
					onClear={onClear}
					search={
						<SearchInput
							value={searchText}
							onChange={onSearchChange}
							placeholder="搜索标题..."
						/>
					}
					filters={
						<>
							<Select
								size="sm"
								placeholder="问卷类型"
								data={TYPE_OPTIONS}
								value={typeFilter || null}
								onChange={(v) => onTypeFilterChange(v ?? "")}
								w={130}
							/>
							<Select
								size="sm"
								placeholder="状态"
								data={[
									{ value: "", label: "全部" },
									{ value: "active", label: "启用" },
									{ value: "inactive", label: "禁用" },
								]}
								value={statusFilter || null}
								onChange={(v) => onStatusFilterChange(v ?? "")}
								w={110}
							/>
						</>
					}
				/>

				<Group justify="space-between" mb="md">
					<Text size="sm" c="dimmed">共 {total} 条</Text>
				</Group>

				<DataTable
					columns={columns}
					rows={templates}
					rowKey={(t) => t.id}
					loading={isLoading}
					emptyIcon={IconClipboardCheck as never}
					emptyTitle="暂无问卷模板"
					emptyDescription="点击上方按钮创建第一个问卷模板"
					total={total}
					offset={offset}
					limit={limit}
					onOffsetChange={onOffsetChange}
					bare
				/>
			</Paper>
		</>
	);
}
