import { Eye, EyeOff, MoreHorizontal, Pencil, Play, Plus, Search, Trash2, Wand2, X } from "lucide-react";
import { useState } from "react";
import Button from "@/components/ui/button";
import Pagination from "@/components/ui/pagination";
import { ALL_CAPABILITIES } from "@/engine/capabilities.gen";
import type { components } from "@/api/api-types.gen";

type CaseManageItem = components["schemas"]["CaseManageItem"];

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

const DIFFICULTY_LABELS: Record<number, string> = { 1: "初级", 2: "中级", 3: "高级" };
const STATUS_LABELS: Record<string, string> = { history_taking: "病史采集", triage: "预检分诊" };

function CapabilityBadges({ caps }: { caps: Record<string, boolean> | undefined }) {
	if (!caps) return null;
	const defs = Object.entries(ALL_CAPABILITIES).filter(([, def]) => def.tier === "toggleable");
	const enabled = defs.filter(([key]) => caps[key]);
	if (enabled.length === 0) return <span className="text-muted-foreground/40 text-xs">—</span>;
	return (
		<div className="flex gap-1">
			{enabled.map(([key, def]) => (
				<span key={key} className="inline-flex items-center rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
					{def.label}
				</span>
			))}
		</div>
	);
}

export default function CaseList({
	cases, total, offset, limit,
	filters, searchInput,
	onSearchChange, onFilterChange, onOffsetChange,
	onAdd, onAIAdd, onEdit, onDelete, onToggleOpen,
}: CaseListProps) {
	const [menuOpen, setMenuOpen] = useState<number | null>(null);

	return (
		<div className="space-y-4">
			{/* Toolbar */}
			<div className="flex flex-wrap items-center gap-3">
				<Button onClick={onAdd}><Plus size={16} />添加病例</Button>
				<Button variant="outline" onClick={onAIAdd}><Wand2 size={16} />AI 生成</Button>
				<div className="flex-1" />
				<div className="flex items-center gap-2">
					<select value={filters.training_type} onChange={(e) => onFilterChange({ ...filters, training_type: e.target.value })}
						className="h-8 rounded-md border border-border bg-background px-2 text-xs">
						<option value="">全部类型</option>
						<option value="history_taking">病史采集</option>
					</select>
					<select value={filters.difficulty} onChange={(e) => onFilterChange({ ...filters, difficulty: e.target.value })}
						className="h-8 rounded-md border border-border bg-background px-2 text-xs">
						<option value="">全部难度</option>
						<option value="1">初级</option>
						<option value="2">中级</option>
						<option value="3">高级</option>
					</select>
					<select value={filters.is_open} onChange={(e) => onFilterChange({ ...filters, is_open: e.target.value })}
						className="h-8 rounded-md border border-border bg-background px-2 text-xs">
						<option value="">全部状态</option>
						<option value="true">开放</option>
						<option value="false">未开放</option>
					</select>
					<div className="relative w-40">
						<Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
						<input type="text" value={searchInput} onChange={(e) => onSearchChange(e.target.value)}
							placeholder="搜索病例…" className="h-8 w-full pl-8 pr-6 rounded-md border border-border bg-background text-xs outline-none focus:border-primary/50" />
						{searchInput && <button onClick={() => onSearchChange("")} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"><X size={12} /></button>}
					</div>
				</div>
			</div>

			{/* Table */}
			<div className="rounded-lg border border-border bg-card overflow-hidden">
				<table className="w-full text-sm">
					<thead>
						<tr className="border-b border-border bg-muted/50">
							<th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">病例名称</th>
							<th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground hidden sm:table-cell">难度</th>
							<th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground hidden md:table-cell">类型</th>
							<th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground hidden lg:table-cell">能力</th>
							<th className="text-center px-4 py-2.5 text-xs font-medium text-muted-foreground w-20">状态</th>
							<th className="text-right px-4 py-2.5 text-xs font-medium text-muted-foreground w-12"></th>
						</tr>
					</thead>
					<tbody>
						{cases.map((c) => (
							<tr key={c.id} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
								<td className="px-4 py-3">
									<div className="font-medium truncate max-w-[200px]">{c.name}</div>
									<div className="text-xs text-muted-foreground truncate max-w-[200px] mt-0.5">
										{[c.patient_gender, c.patient_age != null ? `${c.patient_age}岁` : null].filter(Boolean).join(" · ")}
									</div>
								</td>
								<td className="px-4 py-3 hidden sm:table-cell">
									<span className="text-xs">{DIFFICULTY_LABELS[c.difficulty ?? 1]}</span>
								</td>
								<td className="px-4 py-3 hidden md:table-cell">
									<span className="text-xs text-muted-foreground">{STATUS_LABELS[c.training_type ?? "history_taking"] ?? c.training_type}</span>
								</td>
								<td className="px-4 py-3 hidden lg:table-cell">
									<CapabilityBadges caps={c.capabilities} />
								</td>
								<td className="px-4 py-3 text-center">
									<button type="button" onClick={() => onToggleOpen(c)}
										className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium transition-colors ${
											c.is_open ? "bg-emerald-50 text-emerald-700 hover:bg-emerald-100" : "bg-muted text-muted-foreground hover:bg-muted/70"
										}`}>
										{c.is_open ? <Eye size={12} /> : <EyeOff size={12} />}
										{c.is_open ? "开放" : "关闭"}
									</button>
								</td>
								<td className="px-4 py-3 text-right relative">
									<button type="button" onClick={() => setMenuOpen(menuOpen === c.id ? null : c.id)}
										className="p-1 rounded hover:bg-muted text-muted-foreground">
										<MoreHorizontal size={16} />
									</button>
									{menuOpen === c.id && (
										<div className="absolute right-2 top-10 z-20 w-32 rounded-lg border border-border bg-popover shadow-lg py-1"
											onMouseLeave={() => setMenuOpen(null)}>
											<button onClick={() => { onEdit(c); setMenuOpen(null); }}
												className="flex w-full items-center gap-2 px-3 py-1.5 text-xs hover:bg-muted">
												<Pencil size={12} />编辑
											</button>
											<button onClick={() => { onToggleOpen(c); setMenuOpen(null); }}
												className="flex w-full items-center gap-2 px-3 py-1.5 text-xs hover:bg-muted">
												{c.is_open ? <EyeOff size={12} /> : <Eye size={12} />}
												{c.is_open ? "关闭" : "开放"}
											</button>
											<button onClick={() => { onDelete(c); setMenuOpen(null); }}
												disabled={c.training_count > 0}
												className="flex w-full items-center gap-2 px-3 py-1.5 text-xs hover:bg-red-50 text-red-600 disabled:opacity-30">
												<Trash2 size={12} />删除
											</button>
										</div>
									)}
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>

			{total > limit && <Pagination total={total} offset={offset} limit={limit} onChange={onOffsetChange} />}
		</div>
	);
}
