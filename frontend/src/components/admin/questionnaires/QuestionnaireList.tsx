import { Group, Paper, Select, Text } from "@mantine/core";
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
import Badge from "@/components/ui/badge";
import Button from "@/components/ui/button";
import DataTable, { type DataTableColumn } from "@/components/ui/data-table";
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
				<Badge variant={t.type === "pre" ? "info" : "success"}>
					{TYPE_LABEL[t.type] || t.type}
				</Badge>
			),
		},
		{
			key: "status",
			header: "状态",
			render: (t) => (
				<Badge variant={t.is_active ? "success" : "neutral"}>
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
					c={t.response_count > 0 ? "teal" : "dimmed"}
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
						variant="ghost"
						onClick={() => onEdit(t)}
						title="编辑"
					>
						<IconEdit size={14} />
					</Button>
					<Button
						size="sm"
						variant="ghost"
						onClick={() => onAssign(t)}
						title="分配病例"
					>
						<IconFileText size={14} />
					</Button>
					<Button
						size="sm"
						variant="ghost"
						onClick={() => onViewStats(t)}
						title="查看数据"
					>
						<IconChartBar size={14} />
					</Button>
					<Button
						size="sm"
						variant="destructive"
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

			<Paper withBorder shadow="sm" p="md" radius="lg">
				<Paper
					withBorder
					bg="var(--mantine-color-gray-1)"
					p="md"
					radius="lg"
					mb="md"
				>
					<Group align="flex-end" gap="md">
						<Select
							label="问卷类型"
							data={TYPE_OPTIONS}
							value={typeFilter || null}
							onChange={(v) => {
								onTypeFilterChange(v ?? "");
								onOffsetChange(0);
							}}
						/>
						<Select
							label="状态"
							data={[
								{ value: "", label: "全部" },
								{ value: "active", label: "启用" },
								{ value: "inactive", label: "禁用" },
							]}
							value={statusFilter || null}
							onChange={(v) => {
								onStatusFilterChange(v ?? "");
								onOffsetChange(0);
							}}
						/>
						<div>
							<Text size="xs" fw={600} c="dimmed" mb={4}>
								搜索
							</Text>
							<SearchInput
								value={searchText}
								onChange={(v) => {
									onSearchChange(v);
									onOffsetChange(0);
								}}
								placeholder="搜索标题..."
							/>
						</div>
					</Group>
				</Paper>

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
