import { ClipboardList, Edit3, Plus, Trash2, Wand2 } from "lucide-react";
import Badge from "@/components/ui/badge";
import Button from "@/components/ui/button";
import EmptyState from "@/components/ui/empty-state";
import Pagination from "@/components/ui/pagination";
import { cn } from "@/lib/utils";
import type { CaseManageItem } from "./types";
import { difficultyLabel, inputClass } from "./types";

interface CaseListProps {
	cases: CaseManageItem[];
	total: number;
	offset: number;
	limit: number;
	filters: { name: string; difficulty: string };
	searchInput: string;
	onSearchChange: (value: string) => void;
	onFilterChange: (filters: { name: string; difficulty: string }) => void;
	onOffsetChange: (offset: number) => void;
	onAdd: () => void;
	onAIAdd: () => void;
	onEdit: (c: CaseManageItem) => void;
	onDelete: (c: CaseManageItem) => void;
}

export default function CaseList({
	cases,
	total,
	offset,
	limit,
	filters,
	searchInput,
	onSearchChange,
	onFilterChange,
	onOffsetChange,
	onAdd,
	onAIAdd,
	onEdit,
	onDelete,
}: CaseListProps) {
	return (
		<>
			<div className="mb-4 flex gap-3">
				<Button onClick={onAdd}>
					<Plus size={16} /> 添加病例
				</Button>
				<Button
					variant="outline"
					onClick={onAIAdd}
					className="border-purple-300 bg-purple-50 text-purple-700 hover:bg-purple-100"
				>
					<Wand2 size={16} /> AI 生成病例
				</Button>
			</div>

			<div className="rounded-xl border border-border bg-card shadow-sm p-6">
				<div className="mb-4 rounded-xl border border-border bg-muted p-4">
					<div className="flex gap-3 flex-wrap">
						<label className="flex-1 min-w-[160px]">
							<span className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">
								病例名称
							</span>
							<input
								placeholder="模糊搜索..."
								value={searchInput}
								onChange={(e) => onSearchChange(e.target.value)}
								className={inputClass}
							/>
						</label>
						<label className="flex-1 min-w-[160px]">
							<span className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">
								困难程度
							</span>
							<select
								value={filters.difficulty || ""}
								onChange={(e) =>
									onFilterChange({ ...filters, difficulty: e.target.value })
								}
								className={inputClass}
							>
								<option value="">全部</option>
								<option value="1">初级</option>
								<option value="2">中级</option>
								<option value="3">高级</option>
							</select>
						</label>
					</div>
				</div>

				<div className="mb-4 flex items-center justify-between">
					<span className="text-sm text-muted-foreground">共 {total} 条</span>
				</div>
				{cases.length === 0 ? (
					<EmptyState icon={ClipboardList} title="暂无病例，点击上方按钮添加" />
				) : (
					<div className="overflow-x-auto">
						<table className="w-full border-collapse text-sm">
							<thead>
								<tr>
									<th className="sticky top-0 z-10 text-left px-4 py-2.5 bg-muted text-muted-foreground font-semibold text-xs uppercase tracking-wider border-b border-border">
										病例名称
									</th>
									<th className="sticky top-0 z-10 text-left px-4 py-2.5 bg-muted text-muted-foreground font-semibold text-xs uppercase tracking-wider border-b border-border">
										难度
									</th>
									<th className="sticky top-0 z-10 text-left px-4 py-2.5 bg-muted text-muted-foreground font-semibold text-xs uppercase tracking-wider border-b border-border">
										患者
									</th>
									<th className="sticky top-0 z-10 text-left px-4 py-2.5 bg-muted text-muted-foreground font-semibold text-xs uppercase tracking-wider border-b border-border">
										主诉
									</th>
									<th className="sticky top-0 z-10 text-left px-4 py-2.5 bg-muted text-muted-foreground font-semibold text-xs uppercase tracking-wider border-b border-border">
										时限
									</th>
									<th className="sticky top-0 z-10 text-left px-4 py-2.5 bg-muted text-muted-foreground font-semibold text-xs uppercase tracking-wider border-b border-border">
										训练次数
									</th>
									<th className="sticky top-0 z-10 text-left px-4 py-2.5 bg-muted text-muted-foreground font-semibold text-xs uppercase tracking-wider border-b border-border">
										操作
									</th>
								</tr>
							</thead>
							<tbody>
								{cases.map((c) => (
									<tr key={c.id} className="hover:bg-muted">
										<td className="px-4 py-3 border-b border-border font-medium">
											{c.name}
										</td>
										<td className="px-4 py-3 border-b border-border">
											{difficultyLabel(c.difficulty)}
										</td>
										<td className="px-4 py-3 border-b border-border">
											{c.patient_name
												? `${c.patient_name}${c.patient_age ? ` · ${c.patient_age}岁` : ""}${c.patient_gender ? ` · ${c.patient_gender}` : ""}`
												: "-"}
										</td>
										<td className="px-4 py-3 border-b border-border max-w-[200px] overflow-hidden text-ellipsis whitespace-nowrap">
											{c.chief_complaint || "-"}
										</td>
										<td className="px-4 py-3 border-b border-border">
											<Badge variant="info">{c.time_limit || 20} 分钟</Badge>
										</td>
										<td
											className={cn(
												"px-4 py-3 border-b border-border font-medium",
												c.training_count > 0
													? "text-primary"
													: "text-muted-foreground/70",
											)}
										>
											{c.training_count}
										</td>
										<td className="px-4 py-3 border-b border-border">
											<div className="flex gap-2">
												<Button
													size="sm"
													variant="ghost"
													onClick={() => onEdit(c)}
													title="编辑"
												>
													<Edit3 size={14} />
												</Button>
												<Button
													size="sm"
													variant="danger"
													onClick={() => onDelete(c)}
													disabled={c.training_count > 0}
													title={
														c.training_count > 0
															? "有训练记录，无法删除"
															: "删除"
													}
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
