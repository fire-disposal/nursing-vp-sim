import { Pencil, Play, Plus, Search, Trash2, Wand2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
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
				<span key={key} className="inline-flex items-center rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{def.label}</span>
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

	return (
		<div className="space-y-4">
			{/* Toolbar */}
			<div className="flex items-center gap-2 flex-wrap">
				<Button size="sm" onClick={onAdd}><Plus size={14} />新建病例</Button>
				<Button size="sm" variant="outline" onClick={onAIAdd}><Wand2 size={14} />AI 生成</Button>
				<div className="flex-1" />
				<div className="relative">
					<Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
					<input type="text" value={searchInput} onChange={(e) => onSearchChange(e.target.value)}
						placeholder="搜索病例…" className="h-8 w-40 pl-8 pr-6 rounded-md border border-border bg-background text-xs outline-none focus:border-primary/50" />
					{searchInput && <button onClick={() => onSearchChange("")} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"><X size={12} /></button>}
				</div>
			</div>

			{/* Filters */}
			<div className="flex gap-2 flex-wrap">
				<select value={filters.difficulty} onChange={(e) => onFilterChange({ ...filters, difficulty: e.target.value })}
					className="h-7 rounded-md border border-border bg-background px-2 text-xs">
					<option value="">全部难度</option>
					<option value="1">初级</option><option value="2">中级</option><option value="3">高级</option>
				</select>
				<select value={filters.training_type} onChange={(e) => onFilterChange({ ...filters, training_type: e.target.value })}
					className="h-7 rounded-md border border-border bg-background px-2 text-xs">
					<option value="">全部类型</option>
					<option value="history_taking">病史采集</option><option value="triage">预检分诊</option>
				</select>
				<select value={filters.is_open} onChange={(e) => onFilterChange({ ...filters, is_open: e.target.value })}
					className="h-7 rounded-md border border-border bg-background px-2 text-xs">
					<option value="">全部状态</option>
					<option value="true">已开放</option><option value="false">已关闭</option>
				</select>
			</div>

			{/* Table */}
			<div className="rounded-lg border border-border bg-card overflow-x-auto">
				<table className="w-full text-sm table-fixed min-w-[640px]">
					<thead>
						<tr className="border-b border-border bg-muted/50">
							<th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground w-[26%]">病例名称</th>
							<th className="text-left px-2 py-2 text-xs font-medium text-muted-foreground w-[10%]">难度</th>
							<th className="text-left px-2 py-2 text-xs font-medium text-muted-foreground w-[12%]">类型</th>
							<th className="text-left px-2 py-2 text-xs font-medium text-muted-foreground w-[22%]">能力</th>
							<th className="text-center px-2 py-2 text-xs font-medium text-muted-foreground w-[16%]">状态</th>
							<th className="text-center px-2 py-2 text-xs font-medium text-muted-foreground w-[14%]">操作</th>
						</tr>
					</thead>
					<tbody>
						{cases.map((c) => (
							<tr key={c.id} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
								<td className="px-3 py-2">
									<div className="font-medium text-xs truncate">{c.name}</div>
									<div className="text-[10px] text-muted-foreground truncate mt-0.5">
										{[c.patient_gender, c.patient_age != null ? `${c.patient_age}岁` : null].filter(Boolean).join(" · ")}
									</div>
								</td>
								<td className="px-2 py-2"><span className="text-xs">{DIFFICULTY_LABELS[c.difficulty ?? 1]}</span></td>
								<td className="px-2 py-2"><span className="text-xs text-muted-foreground">{STATUS_LABELS[c.training_type ?? "history_taking"] ?? c.training_type}</span></td>
								<td className="px-2 py-2"><CapabilityBadges caps={c.capabilities} /></td>
								<td className="px-2 py-2 text-center">
									<button type="button" onClick={() => onToggleOpen(c)}
										className={`text-[10px] font-medium rounded px-1.5 py-0.5 ${c.is_open ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400" : "bg-muted text-muted-foreground"}`}>
										{c.is_open ? "开放" : "关闭"}
									</button>
								</td>
								<td className="px-2 py-2">
									<div className="flex items-center justify-center gap-0.5">
										<button type="button" onClick={() => onEdit(c)} className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground" title="编辑"><Pencil size={13} /></button>
										<button type="button" onClick={() => onDelete(c)} className="p-1 rounded hover:bg-red-50 text-muted-foreground hover:text-red-600 dark:hover:bg-red-950/30" title="删除"><Trash2 size={13} /></button>
									</div>
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
