import { Badge, Button, Group, Text } from "@mantine/core";
import {
	IconChartBar,
	IconClipboardCheck,
	IconClipboardList,
	IconEdit,
	IconFileText,
	IconTrash,
} from "@tabler/icons-react";
import { useNavigate } from "react-router-dom";
import type { TemplateListItem } from "@/components/admin/questionnaires/types";
import { TYPE_LABEL } from "@/components/admin/questionnaires/types";
import DataTable, { type DataTableColumn } from "@/components/ui/data-table";

interface QuestionnaireListProps {
	templates: TemplateListItem[];
	isLoading: boolean;
	onEdit: (t: TemplateListItem) => void;
	onDelete: (t: TemplateListItem) => void;
	onAssign: (t: TemplateListItem) => void;
}

/**
 * 问卷模板列表。
 *
 * 「统计」与「答卷」都不再由本地 view 状态承载：它们是可前进/后退/刷新/分享的页面，
 * 各自有自己的地址（`/admin/questionnaires/:id/stats` / `.../responses`）。
 * 只有编辑器和分配仍走弹窗——它们是就地修改，关掉即回列表，没有独立浏览价值。
 */
export default function QuestionnaireList({
	templates,
	isLoading,
	onEdit,
	onDelete,
	onAssign,
}: QuestionnaireListProps) {
	const navigate = useNavigate();
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
						onClick={() => navigate(`/admin/questionnaires/${t.id}/stats`)}
						title="查看统计"
						aria-label="查看统计"
					>
						<IconChartBar size={14} />
					</Button>
					<Button
						size="sm"
						variant="subtle"
						color="gray"
						onClick={() => navigate(`/admin/questionnaires/${t.id}/responses`)}
						title="查看答卷"
						aria-label="查看答卷"
					>
						<IconClipboardList size={14} />
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
