import { Check, ChevronsUpDown, Loader2, Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/utils/cn";

export interface CaseOption {
	id: number;
	name: string;
	difficulty?: number;
	training_type?: string;
}

interface CaseSelectorProps {
	cases: CaseOption[];
	value: number;
	onChange: (id: number) => void;
	loading?: boolean;
}

const TRAINING_TYPE_LABELS: Record<string, string> = {
	history_taking: "病史采集",
	triage: "分诊",
};

const DIFFICULTY_LABELS: Record<number, string> = {
	1: "初级",
	2: "中级",
	3: "高级",
};

const DIFFICULTY_COLORS: Record<number, string> = {
	1: "bg-emerald-100 text-emerald-700",
	2: "bg-amber-100 text-amber-700",
	3: "bg-rose-100 text-rose-700",
};

export default function CaseSelector({ cases, value, onChange, loading }: CaseSelectorProps) {
	const [open, setOpen] = useState(false);
	const [search, setSearch] = useState("");
	const ref = useRef<HTMLDivElement>(null);

	useEffect(() => {
		function handleClick(e: MouseEvent) {
			if (ref.current && !ref.current.contains(e.target as Node)) {
				setOpen(false);
			}
		}
		if (open) {
			document.addEventListener("mousedown", handleClick);
			return () => document.removeEventListener("mousedown", handleClick);
		}
	}, [open]);

	const selected = cases.find((c) => c.id === value);

	const filtered = cases.filter((c) => {
		if (!search.trim()) return true;
		const q = search.toLowerCase();
		return (
			c.name.toLowerCase().includes(q) ||
			(c.training_type ? (TRAINING_TYPE_LABELS[c.training_type] || c.training_type).toLowerCase().includes(q) : false)
		);
	});

	return (
		<div ref={ref} className="relative">
			<button
				type="button"
				onClick={() => {
					setOpen(!open);
					setSearch("");
				}}
				className={cn(
					"w-full flex items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm text-left",
					"hover:bg-muted/50 transition-colors",
					!selected && "text-muted-foreground",
				)}
			>
				<span className="truncate pr-2">
					{selected ? (
						<span className="flex items-center gap-2">
							<span className="font-medium truncate max-w-[200px]">{selected.name}</span>
							{selected.difficulty && (
								<span className={cn("shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium", DIFFICULTY_COLORS[selected.difficulty] || "bg-muted text-muted-foreground")}>
									{DIFFICULTY_LABELS[selected.difficulty] || selected.difficulty}
								</span>
							)}
							{selected.training_type && TRAINING_TYPE_LABELS[selected.training_type] && (
								<span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
									{TRAINING_TYPE_LABELS[selected.training_type]}
								</span>
							)}
						</span>
					) : (
						"选择病例..."
					)}
				</span>
				<ChevronsUpDown size={14} className="shrink-0 text-muted-foreground" />
			</button>

			{open && (
				<div className="absolute z-50 mt-1 w-full rounded-lg border border-border bg-popover shadow-lg">
					<div className="flex items-center border-b border-border px-3 py-2">
						<Search size={14} className="mr-2 shrink-0 text-muted-foreground" />
						<input
							autoFocus
							type="text"
							placeholder="搜索病例..."
							value={search}
							onChange={(e) => setSearch(e.target.value)}
							className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
						/>
					</div>
					<div className="max-h-[280px] overflow-y-auto py-1">
						{loading ? (
							<div className="flex items-center justify-center gap-2 px-3 py-6 text-sm text-muted-foreground">
								<Loader2 size={14} className="animate-spin" />
								加载中...
							</div>
						) : filtered.length === 0 ? (
							<div className="px-3 py-6 text-center text-sm text-muted-foreground">
								{search ? "无匹配病例" : "暂无可选病例"}
							</div>
						) : (
							filtered.map((c) => (
								<button
									type="button"
									key={c.id}
									onClick={() => {
										onChange(c.id);
										setOpen(false);
										setSearch("");
									}}
									className={cn(
										"w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-muted transition-colors",
										c.id === value && "bg-primary/10",
									)}
								>
									<Check
										size={14}
										className={cn(
											"shrink-0",
											c.id === value ? "text-primary opacity-100" : "opacity-0",
										)}
									/>
									<span className="font-medium truncate flex-1">{c.name}</span>
									{c.difficulty && (
										<span className={cn("shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium", DIFFICULTY_COLORS[c.difficulty] || "bg-muted text-muted-foreground")}>
											{DIFFICULTY_LABELS[c.difficulty] || c.difficulty}
										</span>
									)}
									{c.training_type && TRAINING_TYPE_LABELS[c.training_type] && (
										<span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
											{TRAINING_TYPE_LABELS[c.training_type]}
										</span>
									)}
								</button>
							))
						)}
					</div>
				</div>
			)}
		</div>
	);
}
