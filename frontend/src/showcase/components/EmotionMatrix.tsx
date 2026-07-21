import { useMemo } from "react";
import { cn } from "@/utils/cn";

const STATES = [
	{ trust: 70, comfort: 70, label: "open",     emoji: "😄", display: "开放信任", desc: "愿意详细叙述，主动补充信息", color: "green" },
	{ trust: 30, comfort: 60, label: "relaxed",  emoji: "😊", display: "放松友好", desc: "语气友好，配合回答", color: "blue" },
	{ trust: 30, comfort: 35, label: "neutral",  emoji: "🙂", display: "正常配合", desc: "中性叙述，按常规节奏交流", color: "slate" },
	{ trust: 30, comfort:  0, label: "anxious",  emoji: "😰", display: "焦虑不安", desc: "谨慎反复确认，语气急促", color: "purple" },
	{ trust:  0, comfort: 30, label: "defensive",emoji: "😟", display: "防御抵触", desc: "回避关键问题，短句回复", color: "orange" },
];

const FALLBACK = { label: "withdrawn", emoji: "😐", display: "沉默回避", desc: "不愿展开对话，回复极少", color: "red" };

export default function EmotionMatrix() {
	const active = useMemo(() => STATES[2], []); // neutral as demo

	return (
		<div className="group relative overflow-hidden rounded-3xl border border-border/60 bg-card p-6">
			<div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(236,72,153,0.10),transparent_40%),radial-gradient(circle_at_bottom_right,rgba(13,148,136,0.08),transparent_36%)]" />
			<div className="relative z-10 flex items-center justify-between gap-4">
				<div>
					<div className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">情绪状态机</div>
					<div className="mt-1 text-lg font-bold text-foreground">信任 × 舒适 (6 态)</div>
				</div>
				<div className="rounded-full border border-border/70 bg-background/70 px-3 py-1 text-xs font-medium text-muted-foreground">
					首次匹配
				</div>
			</div>

			<div className="relative z-10 mt-5 space-y-2.5">
				{STATES.map((s) => (
					<div key={s.label} className="flex items-center gap-3 rounded-xl border border-border/60 bg-background/70 p-4">
						<span className="text-2xl shrink-0">{s.emoji}</span>
						<div className="flex-1 min-w-0">
							<div className="flex items-center gap-2">
								<span className="text-sm font-bold text-foreground">{s.display}</span>
								<span className="text-[10px] uppercase tracking-wide text-muted-foreground">{s.label}</span>
							</div>
							<div className="mt-0.5 text-xs text-muted-foreground">{s.desc}</div>
							<div className="mt-1.5 flex items-center gap-3 text-[10px] text-muted-foreground">
								<span className="inline-flex items-center gap-1">
									<span className={cn("size-1.5 rounded-full", s.color === "green" && "bg-emerald-500", s.color === "blue" && "bg-blue-500", s.color === "slate" && "bg-slate-400", s.color === "purple" && "bg-purple-500", s.color === "orange" && "bg-orange-500")} />
									信任 ≥ {s.trust}
								</span>
								<span className="inline-flex items-center gap-1">
									<span className={cn("size-1.5 rounded-full", s.color === "green" && "bg-emerald-500", s.color === "blue" && "bg-blue-500", s.color === "slate" && "bg-slate-400", s.color === "purple" && "bg-purple-500", s.color === "orange" && "bg-orange-500")} />
									舒适 ≥ {s.comfort}
								</span>
							</div>
						</div>
					</div>
				))}
				<div className="flex items-center gap-3 rounded-xl border border-dashed border-border/60 bg-muted/30 p-4">
					<span className="text-2xl shrink-0 opacity-50">{FALLBACK.emoji}</span>
					<div className="flex-1 min-w-0">
						<div className="flex items-center gap-2">
							<span className="text-sm font-bold text-muted-foreground">{FALLBACK.display}</span>
							<span className="text-[10px] uppercase tracking-wide text-muted-foreground/60">{FALLBACK.label}</span>
							<span className="text-[10px] text-muted-foreground/50">通配 fallback</span>
						</div>
						<div className="mt-0.5 text-xs text-muted-foreground/60">{FALLBACK.desc}</div>
						<div className="mt-1.5 flex items-center gap-1 text-[10px] text-muted-foreground/50">
							<span className={cn("size-1.5 rounded-full bg-red-500")} />
							不满足以上任意条件时
						</div>
					</div>
				</div>
			</div>

			<div className="relative z-10 mt-5 rounded-2xl border border-border/60 bg-background/70 p-5 backdrop-blur-sm">
				<div className="flex items-center justify-between gap-4">
					<div>
						<div className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">匹配规则</div>
						<div className="mt-1 text-sm text-muted-foreground">从上到下首次匹配，无匹配则 withdrawn</div>
					</div>
					<div className="rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
						{active.display} {active.emoji}
					</div>
				</div>
			</div>
		</div>
	);
}
