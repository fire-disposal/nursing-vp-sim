import { Badge, Button, Group, Text } from "@mantine/core";
import {
	IconChartBar,
	IconClipboardCheck,
	IconEdit,
	IconFileText,
	IconTrash,
} from "@tabler/icons-react";
import type { TemplateListItem } from "@/components/admin/questionnaires/types";
import { TYPE_LABEL } from "@/components/admin/questionnaires/types";
import DataTable, { type DataTableColumn } from "@/components/ui/data-table";

interface QuestionnaireListProps {
	templates: TemplateListItem[];
	isLoading: boolean;
	onEdit: (t: TemplateListItem) => void;
	onDelete: (t: TemplateListItem) => void;
	onAssign: (t: TemplateListItem) => void;
	onViewStats: (t: TemplateListItem) => void;
}

export default function QuestionnaireList({
	templates,
	isLoading,
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
					{/* 图标按钮只有 glyph，无文字：aria-label 才是屏幕阅读器的可访问名（title 仅作鼠标提示） */}
					<Button
						size="sm"
						variant="subtle"
						color="gray"
						onClick={() => onEdit(t)}
						title="编辑"
						aria-label="编辑"
					>
						<IconEdit size={14} />
					</Button>
					<Button
						size="sm"
						variant="subtle"
						color="gray"
						onClick={() => onAssign(t)}
						title="分配病例"
						aria-label="分配病例"
					>
						<IconFileText size={14} />
					</Button>
					<Button
						size="sm"
						variant="subtle"
						color="gray"
						onClick={() => onViewStats(t)}
						title="查看数据"
						aria-label="查看数据"
					>
						<IconChartBar size={14} />
					</Button>
					<Button
						size="sm"
						variant="subtle"
						color="red"
						onClick={() => onDelete(t)}
						title="删除"
						aria-label="删除"
					>
						<IconTrash size={14} />
					</Button>
				</Group>
			),
		},
	];

	return (
		<DataTable
			columns={columns}
			rows={templates}
			rowKey={(t) => t.id}
			loading={isLoading}
			emptyIcon={IconClipboardCheck as never}
			emptyTitle="暂无问卷模板"
			emptyDescription="点击上方「新建问卷」创建第一个问卷模板"
			// 表头不再自粘：ListPage 的筛选带已经吸顶，表头再 sticky top:0 会滑到带子上面盖住它
			stickyHeader={false}
			bare
			minWidth={720}
		/>
	);
}
