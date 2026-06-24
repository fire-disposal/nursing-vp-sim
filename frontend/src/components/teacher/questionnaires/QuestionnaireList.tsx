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
import EmptyState from "@/components/ui/empty-state";
import LoadingState from "@/components/ui/loading-state";
import Pagination from "@/components/ui/pagination";
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

				{isLoading ? (
					<LoadingState />
				) : templates.length === 0 ? (
					<EmptyState
						icon={ClipboardCheck}
						title="暂无问卷模板"
						description="点击上方按钮创建第一个问卷模板"
					/>
				) : (
					<div className="overflow-x-auto">
						<table className="w-full border-collapse text-sm">
							<thead>
								<tr>
									<th className="sticky top-0 z-10 text-left px-4 py-2.5 bg-muted text-muted-foreground font-semibold text-xs uppercase tracking-wider border-b border-border">
										标题
									</th>
									<th className="sticky top-0 z-10 text-left px-4 py-2.5 bg-muted text-muted-foreground font-semibold text-xs uppercase tracking-wider border-b border-border">
										类型
									</th>
									<th className="sticky top-0 z-10 text-left px-4 py-2.5 bg-muted text-muted-foreground font-semibold text-xs uppercase tracking-wider border-b border-border">
										状态
									</th>
									<th className="sticky top-0 z-10 text-left px-4 py-2.5 bg-muted text-muted-foreground font-semibold text-xs uppercase tracking-wider border-b border-border">
										题目数
									</th>
									<th className="sticky top-0 z-10 text-left px-4 py-2.5 bg-muted text-muted-foreground font-semibold text-xs uppercase tracking-wider border-b border-border">
										回收数
									</th>
									<th className="sticky top-0 z-10 text-left px-4 py-2.5 bg-muted text-muted-foreground font-semibold text-xs uppercase tracking-wider border-b border-border">
										操作
									</th>
								</tr>
							</thead>
							<tbody>
								{templates.map((t) => (
									<tr key={t.id} className="hover:bg-muted">
										<td className="px-4 py-3 border-b border-border font-medium">
											{t.title}
											{t.description && (
												<div className="text-xs text-muted-foreground mt-0.5 truncate max-w-[300px]">
													{t.description}
												</div>
											)}
										</td>
										<td className="px-4 py-3 border-b border-border">
											<Badge variant={t.type === "pre" ? "info" : "success"}>
												{TYPE_LABEL[t.type] || t.type}
											</Badge>
										</td>
										<td className="px-4 py-3 border-b border-border">
											<Badge variant={t.is_active ? "success" : "neutral"}>
												{t.is_active ? "启用" : "禁用"}
											</Badge>
										</td>
										<td className="px-4 py-3 border-b border-border text-muted-foreground">
											{t.question_count}
										</td>
										<td
											className={cn(
												"px-4 py-3 border-b border-border font-medium",
												t.response_count > 0
													? "text-primary"
													: "text-muted-foreground/70",
											)}
										>
											{t.response_count}
										</td>
										<td className="px-4 py-3 border-b border-border">
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
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				)}

				<Pagination
					total={total}
					offset={offset}
					limit={limit}
					onChange={onOffsetChange}
				/>
			</div>
		</>
	);
}
