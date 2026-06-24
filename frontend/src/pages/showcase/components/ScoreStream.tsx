import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

const METRICS = [
	{ label: "沟通技能", value: 14, total: 14 },
	{ label: "病史采集", value: 5, total: 5 },
	{ label: "证据回链", value: 19, total: 19 },
];

export default function ScoreStream() {
	const [tick, setTick] = useState(0);

	useEffect(() => {
		const timer = window.setInterval(() => setTick((value) => (value + 1) % 6), 1400);
		return () => window.clearInterval(timer);
	}, []);

	return (
		<div className="group relative overflow-hidden rounded-3xl border border-border/60 bg-card p-5">
			<div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(217,70,239,0.08),transparent_35%),radial-gradient(circle_at_bottom_right,rgba(13,148,136,0.08),transparent_34%)]" />
			<div className="relative z-10 flex items-center justify-between gap-4">
				<div>
					<div className="text-[10px] font-semibold uppercase tracking-[0.3em] text-muted-foreground">流式评分</div>
					<div className="mt-1 text-base font-bold text-foreground">逐项证据回传</div>
				</div>
				<div className="rounded-full border border-border/70 bg-background/70 px-3 py-1 text-xs font-medium text-muted-foreground">
					SSE live
				</div>
			</div>

			<div className="relative z-10 mt-5 space-y-3">
				{METRICS.map((metric, index) => {
					const progress = Math.min(100, metric.total ? (metric.value / metric.total) * 100 : 0);
					return (
						<div key={metric.label} className="rounded-2xl border border-border/60 bg-background/70 p-3.5">
							<div className="flex items-center justify-between gap-3">
								<div className="text-sm font-medium text-foreground">{metric.label}</div>
								<div className="text-xs font-semibold tabular-nums text-muted-foreground">{metric.value}/{metric.total}</div>
							</div>
							<div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
								<div
									className={cn(
										"h-full rounded-full bg-gradient-to-r transition-all duration-700",
										index === 0 && "from-cyan-500 to-sky-500",
										index === 1 && "from-violet-500 to-fuchsia-500",
										index === 2 && "from-emerald-500 to-teal-500",
									)}
									style={{ width: `${progress}%` }}
								/>
							</div>
						</div>
					);
				})}
			</div>

			<div className="relative z-10 mt-4 flex items-center justify-between gap-3 rounded-2xl border border-border/60 bg-background/70 px-4 py-3">
				<div className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">说明</div>
				<div className="text-sm text-foreground/80">
					{tick % 2 === 0 ? "评分与证据同时返回。" : "可直接追溯到对话依据。"}
				</div>
			</div>
		</div>
	);
}
