import { Check, ChevronsUpDown, Loader2, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

function highlightMatch(text: string, query: string) {
	if (!query.trim()) return <>{text}</>;
	const q = query.toLowerCase();
	const idx = text.toLowerCase().indexOf(q);
	if (idx === -1) return <>{text}</>;
	const before = text.slice(0, idx);
	const match = text.slice(idx, idx + q.length);
	const after = text.slice(idx + q.length);
	return (
		<>
			{before}
			<span className="bg-amber-200 text-amber-900 rounded-sm px-px">{match}</span>
			{after}
		</>
	);
}

export default function CaseSelector({ cases, value, onChange, loading }: CaseSelectorProps) {
	const [open, setOpen] = useState(false);
	const [search, setSearch] = useState("");
	const [activeIndex, setActiveIndex] = useState(0);
	const containerRef = useRef<HTMLDivElement>(null);
	const inputRef = useRef<HTMLInputElement>(null);
	const listRef = useRef<HTMLDivElement>(null);

	const selected = useMemo(() => cases.find((c) => c.id === value), [cases, value]);

	const filtered = useMemo(() => {
		if (!search.trim()) return cases;
		const q = search.toLowerCase();
		return cases.filter((c) => {
			if (c.name.toLowerCase().includes(q)) return true;
			if (c.training_type) {
				const label = TRAINING_TYPE_LABELS[c.training_type] || c.training_type;
				if (label.toLowerCase().includes(q)) return true;
			}
			if (c.difficulty != null) {
				const label = DIFFICULTY_LABELS[c.difficulty] || String(c.difficulty);
				if (label.toLowerCase().includes(q)) return true;
			}
			return false;
		});
	}, [cases, search]);

	useEffect(() => {
		setActiveIndex(0);
	}, [search]);

	useEffect(() => {
		function handleClick(e: MouseEvent) {
			if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
				setOpen(false);
			}
		}
		if (open) {
			document.addEventListener("mousedown", handleClick);
			return () => document.removeEventListener("mousedown", handleClick);
		}
	}, [open]);

	useEffect(() => {
		if (open) {
			const timer = setTimeout(() => inputRef.current?.focus(), 0);
			return () => clearTimeout(timer);
		}
	}, [open]);

	useEffect(() => {
		if (!open || filtered.length === 0) return;
		const el = listRef.current?.children[activeIndex] as HTMLElement | undefined;
		el?.scrollIntoView({ block: "nearest" });
	}, [activeIndex, open, filtered.length]);

	const selectItem = useCallback(
		(id: number) => {
			onChange(id);
			setOpen(false);
			setSearch("");
		},
		[onChange],
	);

	const handleKeyDown = useCallback(
		(e: React.KeyboardEvent) => {
			if (!open) return;
			switch (e.key) {
				case "ArrowDown":
					e.preventDefault();
					setActiveIndex((i) => Math.min(i + 1, filtered.length - 1));
					break;
				case "ArrowUp":
					e.preventDefault();
					setActiveIndex((i) => Math.max(i - 1, 0));
					break;
				case "Enter":
					e.preventDefault();
					if (filtered[activeIndex]) {
						selectItem(filtered[activeIndex].id);
					}
					break;
				case "Escape":
					e.preventDefault();
					setOpen(false);
					break;
			}
		},
		[open, filtered, activeIndex, selectItem],
	);

	const toggle = () => {
		if (open) {
			setOpen(false);
		} else {
			setSearch("");
			setActiveIndex(0);
			setOpen(true);
		}
	};

	return (
		<div ref={containerRef} className="relative">
			<button
				type="button"
				onClick={toggle}
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
							ref={inputRef}
							type="text"
							placeholder="输入关键词搜索病例..."
							value={search}
							onChange={(e) => setSearch(e.target.value)}
							onKeyDown={handleKeyDown}
							className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
						/>
					</div>
					<div ref={listRef} className="max-h-[280px] overflow-y-auto py-1">
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
							filtered.map((c, idx) => (
								<button
									type="button"
									key={c.id}
									onClick={() => selectItem(c.id)}
									onMouseEnter={() => setActiveIndex(idx)}
									className={cn(
										"w-full flex items-center gap-2 px-3 py-2 text-sm text-left transition-colors",
										idx === activeIndex ? "bg-accent" : "hover:bg-muted",
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
									<span className="font-medium truncate flex-1">
										{highlightMatch(c.name, search)}
									</span>
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
