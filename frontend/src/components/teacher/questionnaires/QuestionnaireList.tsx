import {
	BarChart3,
	ClipboardCheck,
	Edit3,
	FileText,
	Plus,
	Trash2,
} from "lucide-react";
import type { TemplateListItem } from "@/components/teacher/questionnaires/types";
import {
	inputClass,
	TYPE_LABEL,
	TYPE_OPTIONS,
} from "@/components/teacher/questionnaires/types";
import Badge from "@/components/ui/badge";
import Button from "@/components/ui/button";
import DataTable, { type DataTableColumn } from "@/components/ui/data-table";
import { cn } from "@/lib/utils";

interface QuestionnaireListProps {
	templates: TemplateListItem[];
	isLoading: boolean;
	total: number;
	offset: number;
	limit: number;
	typeFilter: string;
	onOffsetChange: (offset: number) => void;
	onTypeFilterChange: (type: string) => void;
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
	onOffsetChange,
	onTypeFilterChange,
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
						<div className="text-xs text-muted-foreground mt-0.5 truncate max-w-[300px]">
							{t.description}
						</div>
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
			cellClassName: "text-muted-foreground",
			render: (t) => t.question_count,
		},
		{
			key: "response_count",
			header: "回收数",
			render: (t) => (
				<span
					className={cn(
						"font-medium",
						t.response_count > 0
							? "text-primary"
							: "text-muted-foreground/70",
					)}
				>
					{t.response_count}
				</span>
			),
		},
		{
			key: "actions",
			header: "操作",
			render: (t) => (
				<div className="flex gap-2">
					<Button
						size="sm"
						variant="ghost"
						onClick={() => onEdit(t)}
						title="编辑"
					>
						<Edit3 size={14} />
					</Button>
					<Button
						size="sm"
						variant="ghost"
						onClick={() => onAssign(t)}
						title="分配病例"
					>
						<FileText size={14} />
					</Button>
					<Button
						size="sm"
						variant="ghost"
						onClick={() => onViewStats(t)}
						title="查看数据"
					>
						<BarChart3 size={14} />
					</Button>
					<Button
						size="sm"
						variant="danger"
						onClick={() => onDelete(t)}
						title="删除"
					>
						<Trash2 size={14} />
					</Button>
				</div>
			),
		},
	];

	return (
		<>
			<div className="mb-4 flex gap-3">
				<Button onClick={onCreate}>
					<Plus size={16} /> 新建问卷
				</Button>
			</div>

			<div className="rounded-xl border border-border bg-card shadow-sm p-6">
				<div className="mb-4 rounded-xl border border-border bg-muted p-4">
					<div className="flex gap-3 flex-wrap items-end">
						<label>
							<span className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">
								问卷类型
							</span>
							<select
								value={typeFilter}
								onChange={(e) => {
									onTypeFilterChange(e.target.value);
									onOffsetChange(0);
								}}
								className={inputClass}
							>
								{TYPE_OPTIONS.map((opt) => (
									<option key={opt.value} value={opt.value}>
										{opt.label}
									</option>
								))}
							</select>
						</label>
					</div>
				</div>

				<div className="mb-4 flex items-center justify-between">
					<span className="text-sm text-muted-foreground">共 {total} 条</span>
				</div>

				<DataTable
					columns={columns}
					rows={templates}
					rowKey={(t) => t.id}
					loading={isLoading}
					emptyIcon={ClipboardCheck}
					emptyTitle="暂无问卷模板"
					emptyDescription="点击上方按钮创建第一个问卷模板"
					total={total}
					offset={offset}
					limit={limit}
					onOffsetChange={onOffsetChange}
					bare
				/>
			</div>
		</>
	);
}
