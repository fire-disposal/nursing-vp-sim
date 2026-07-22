import { ClipboardList, Plus, Wand2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import Button from "@/components/ui/button";
import Pagination from "@/components/ui/pagination";
import { inputClass } from "@/utils/styles";
import CaseCard from "./CaseCard";
import type { CaseManageItem } from "./types";

interface CaseListProps {
	cases: CaseManageItem[];
	total: number;
	offset: number;
	limit: number;
	filters: { name: string; difficulty: string; training_type: string; is_open: string };
	searchInput: string;
	onSearchChange: (value: string) => void;
	onFilterChange: (filters: { name: string; difficulty: string; training_type: string; is_open: string }) => void;
	onOffsetChange: (offset: number) => void;
	onAdd: () => void;
	onAIAdd: () => void;
	onEdit: (c: CaseManageItem) => void;
	onDelete: (c: CaseManageItem) => void;
	onToggleOpen: (c: CaseManageItem) => void;
}

export default function CaseList({
	cases, total, offset, limit,
	filters, searchInput,
	onSearchChange, onFilterChange, onOffsetChange,
	onAdd, onAIAdd, onEdit, onDelete, onToggleOpen,
}: CaseListProps) {
	const navigate = useNavigate();

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
						<label className="flex-1 min-w-[160px]">
							<span className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">
								训练类型
							</span>
							<select
								value={filters.training_type || ""}
								onChange={(e) =>
									onFilterChange({ ...filters, training_type: e.target.value })
								}
								className={inputClass}
							>
								<option value="">全部</option>
								<option value="history_taking">问诊</option>
								<option value="triage">分诊</option>
							</select>
						</label>
						<label className="flex-1 min-w-[160px]">
							<span className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">
								学生可见
							</span>
							<select
								value={filters.is_open || ""}
								onChange={(e) =>
									onFilterChange({ ...filters, is_open: e.target.value })
								}
								className={inputClass}
							>
								<option value="">全部</option>
								<option value="true">已开放</option>
								<option value="false">未开放</option>
							</select>
						</label>
					</div>
				</div>

				<div className="mb-4 flex items-center justify-between">
					<span className="text-sm text-muted-foreground">共 {total} 条</span>
				</div>

				{cases.length === 0 ? (
					<div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
						<ClipboardList className="size-12 mb-3 opacity-40" />
						<p className="text-sm">暂无病例，点击上方按钮添加</p>
					</div>
				) : (
					<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
						{cases.map((c) => (
							<CaseCard
								key={c.id}
								caseData={c}
								onEdit={() => onEdit(c)}
								onDelete={() => onDelete(c)}
								onToggleOpen={() => onToggleOpen(c)}
								onStartTraining={(id) =>
									navigate(`/training?caseId=${id}`)
								}
							/>
						))}
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
