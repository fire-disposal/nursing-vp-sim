import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";

type Stage = {
	label: string;
	detail: string;
	accent: string;
};

const STAGES: Stage[] = [
	{ label: "Guard", detail: "权限 / 场景 / 输入校验", accent: "from-cyan-500 to-sky-500" },
	{ label: "Prompt", detail: "上下文装配 / 角色注入", accent: "from-violet-500 to-fuchsia-500" },
	{ label: "LLM", detail: "角色扮演 / 信息逐步披露", accent: "from-emerald-500 to-teal-500" },
	{ label: "Memory", detail: "状态 / 情绪 / 病史写回", accent: "from-amber-500 to-orange-500" },
	{ label: "SSE", detail: "流式评分 / 证据回传", accent: "from-pink-500 to-rose-500" },
	{ label: "Effects", detail: "告警 / 记录 / 结算", accent: "from-indigo-500 to-blue-500" },
];

export default function ProcessPipeline() {
	const [active, setActive] = useState(2);
	const stage = useMemo(() => STAGES[active], [active]);

	return (
		<div className="group relative overflow-hidden rounded-3xl border border-border/60 bg-card p-6 shadow-[0_24px_80px_-40px_rgba(15,23,42,0.55)]">
			<div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(13,148,136,0.10),transparent_42%),radial-gradient(circle_at_bottom_left,rgba(59,130,246,0.08),transparent_36%)]" />
			<div className="relative z-10 flex items-center justify-between gap-4">
				<div>
					<div className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">数据流管道</div>
					<div className="mt-1 text-lg font-bold text-foreground">守卫 → 提示 → 模型 → 记忆 → 流式反馈</div>
				</div>
				<div className="rounded-full border border-border/70 bg-background/70 px-3 py-1 text-xs font-medium text-muted-foreground">
					hover / click
				</div>
			</div>

			<div className="relative z-10 mt-6 grid gap-3 md:grid-cols-6">
				{STAGES.map((item, index) => {
					const isActive = index === active;
					const isPast = index < active;
					return (
						<button
							key={item.label}
							type="button"
							onMouseEnter={() => setActive(index)}
							onFocus={() => setActive(index)}
							onClick={() => setActive(index)}
							className={cn(
								"group/item relative rounded-2xl border px-3 py-4 text-left transition-all duration-300",
								isActive
									? "scale-[1.03] border-primary/40 bg-background shadow-lg shadow-primary/10"
									: "border-border/60 bg-background/50 hover:-translate-y-1 hover:border-primary/20",
								isPast && !isActive && "opacity-90",
								"focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
							)}
						>
							<div className={cn("absolute inset-x-3 top-0 h-px bg-gradient-to-r opacity-0 transition-opacity group-hover/item:opacity-100", item.accent)} />
							<div className={cn("mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br text-sm font-bold text-white shadow-md", item.accent)}>
								{index + 1}
							</div>
							<div className="text-sm font-bold text-foreground">{item.label}</div>
							<div className="mt-1 text-xs leading-relaxed text-muted-foreground">{item.detail}</div>
						</button>
					);
				})}
			</div>

			<div className="relative z-10 mt-6 overflow-hidden rounded-2xl border border-border/60 bg-background/70 p-5 backdrop-blur-sm">
				<div className="flex items-center justify-between gap-4">
					<div>
						<div className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">当前焦点</div>
						<div className="mt-1 text-xl font-bold text-foreground">{stage.label}</div>
					</div>
					<div className={cn("h-2.5 w-28 rounded-full bg-gradient-to-r", stage.accent)} />
				</div>
				<div className="mt-4 grid gap-3 sm:grid-cols-3">
					{[
						"角色与上下文",
						"状态与记忆",
						"反馈与副作用",
					].map((label, index) => (
						<div
							key={label}
							className="rounded-2xl border border-border/60 bg-muted/30 p-4"
						>
							<div className="text-xs font-semibold uppercase tracking-[0.25em] text-muted-foreground">
								0{index + 1}
							</div>
							<div className="mt-2 text-sm font-medium text-foreground">{label}</div>
						</div>
					))}
				</div>
			</div>
		</div>
	);
}
