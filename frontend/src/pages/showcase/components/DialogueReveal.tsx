import { useState } from "react";
import { cn } from "@/lib/utils";

const STEPS = [
	{ label: "初始", text: "轻度回避，仅给出零散信息。", tone: "bg-slate-500" },
	{ label: "追问", text: "随提问逐步披露隐藏病史。", tone: "bg-cyan-500" },
	{ label: "信任", text: "当沟通合适，主动补充细节。", tone: "bg-emerald-500" },
];

export default function DialogueReveal() {
	const [active, setActive] = useState(1);

	return (
		<div className="relative overflow-hidden rounded-3xl border border-border/60 bg-card p-6">
			<div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(13,148,136,0.10),transparent_40%),radial-gradient(circle_at_bottom_left,rgba(59,130,246,0.06),transparent_42%)]" />
			<div className="relative z-10 flex items-center justify-between gap-4">
				<div>
					<div className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">对话解锁</div>
					<div className="mt-1 text-lg font-bold text-foreground">信息按互动逐层展开</div>
				</div>
				<div className="rounded-full border border-border/70 bg-background/70 px-3 py-1 text-xs font-medium text-muted-foreground">tap / hover</div>
			</div>

			<div className="relative z-10 mt-6 grid gap-3">
				{STEPS.map((step, index) => {
					const isActive = active === index;
					const shown = index <= active;
					return (
						<button
							key={step.label}
							type="button"
							onMouseEnter={() => setActive(index)}
							onFocus={() => setActive(index)}
							onClick={() => setActive(index)}
							className={cn(
								"rounded-2xl border p-4 text-left transition-all duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
								isActive ? "border-primary/35 bg-background shadow-lg shadow-primary/10" : "border-border/60 bg-background/70 hover:-translate-y-1",
							)}
						>
							<div className="flex items-start gap-4">
								<div className={cn("mt-1 size-2.5 shrink-0 rounded-full", step.tone, shown ? "opacity-100" : "opacity-30")} />
								<div className="min-w-0 flex-1">
									<div className="flex items-center justify-between gap-4">
										<div className="text-sm font-bold text-foreground">{step.label}</div>
										<div className="text-[10px] font-semibold uppercase tracking-[0.25em] text-muted-foreground">step {index + 1}</div>
									</div>
									<div className="mt-1 text-xs leading-relaxed text-muted-foreground">{step.text}</div>
								</div>
							</div>
						</button>
					);
				})}
			</div>
		</div>
	);
}