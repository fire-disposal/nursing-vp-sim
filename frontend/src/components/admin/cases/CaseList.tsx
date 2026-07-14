import { ClipboardList, Edit3, Eye, EyeOff, Play, Plus, Trash2, Wand2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import Badge from "@/components/ui/badge";
import Button from "@/components/ui/button";
import DataTable, { type DataTableColumn } from "@/components/ui/data-table";
import { DifficultyBadge } from "@/components/ui/difficulty-badge";
import Pagination from "@/components/ui/pagination";
import { cn } from "@/utils/cn";
import type { CaseManageItem } from "./types";
import { inputClass } from "./types";

interface CaseListProps {
	cases: CaseManageItem[];
	total: number;
	offset: number;
	limit: number;
	filters: { name: string; difficulty: string; training_type: string };
	searchInput: string;
	onSearchChange: (value: string) => void;
	onFilterChange: (filters: { name: string; difficulty: string; training_type: string }) => void;
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
	const columns: DataTableColumn<CaseManageItem>[] = [
		{
			key: "name",
			header: "病例名称",
			cellClassName: "font-medium",
			render: (c) => c.name,
		},
		{
			key: "training_type",
			header: "类型",
			render: (c) =>
				c.training_type === "triage" ? (
					<Badge variant="info">分诊</Badge>
				) : (
					<Badge variant="secondary">问诊</Badge>
				),
		},
		{
			key: "difficulty",
			header: "难度",
			render: (c) => <DifficultyBadge level={c.difficulty} />,
		},
		{
			key: "patient",
			header: "患者",
			render: (c) =>
				c.patient_name
					? `${c.patient_name}${c.patient_age ? ` · ${c.patient_age}岁` : ""}${c.patient_gender ? ` · ${c.patient_gender}` : ""}`
					: "-",
		},
		{
			key: "chief_complaint",
			header: "主诉",
			cellClassName:
				"max-w-[200px] overflow-hidden text-ellipsis whitespace-nowrap",
			render: (c) => c.chief_complaint || "-",
		},
		{
			key: "time_limit",
			header: "时限",
			render: (c) => <Badge variant="info">{c.time_limit || 20} 分钟</Badge>,
		},
		{
			key: "training_count",
			header: "训练次数",
			render: (c) => (
				<span
					className={cn(
						"font-medium",
						c.training_count > 0
							? "text-primary"
							: "text-muted-foreground/70",
					)}
				>
					{c.training_count}
				</span>
			),
		},
		{
			key: "is_open",
			header: "开放",
			render: (c) => (
				<button
					type="button"
					onClick={() => onToggleOpen(c)}
					className={cn(
						"inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors",
						c.is_open
							? "bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
							: "bg-muted text-muted-foreground hover:bg-muted/70",
					)}
				>
					{c.is_open ? <Eye size={13} /> : <EyeOff size={13} />}
					{c.is_open ? "可见" : "隐藏"}
				</button>
			),
		},
		{
			key: "actions",
			header: "操作",
			render: (c) => (
				<div className="flex gap-1">
					<Button size="sm" variant="ghost" onClick={() => navigate(`/training?caseId=${c.id}`)}
						title="快速体验">
						<Play size={14} />
					</Button>
					<Button size="sm" variant="ghost" onClick={() => onEdit(c)} title="编辑">
						<Edit3 size={14} />
					</Button>
					<Button size="sm" variant="destructive" onClick={() => onDelete(c)}
						disabled={c.training_count > 0}
						title={c.training_count > 0 ? "有训练记录，无法删除" : "删除"}>
						<Trash2 size={14} />
					</Button>
				</div>
			),
		},
	];

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
					</div>
				</div>

				<div className="mb-4 flex items-center justify-between">
					<span className="text-sm text-muted-foreground">共 {total} 条</span>
				</div>

				<DataTable
					bare
					columns={columns}
					rows={cases}
					rowKey={(c) => c.id}
					emptyIcon={ClipboardList}
					emptyTitle="暂无病例，点击上方按钮添加"
				/>

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
