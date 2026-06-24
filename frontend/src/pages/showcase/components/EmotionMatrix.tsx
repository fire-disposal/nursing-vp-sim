import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";

type Cell = {
	label: string;
	desc: string;
	level: string;
};

const X_AXIS = ["低信任", "中信任", "高信任"];
const Y_AXIS = ["低舒适", "中舒适", "高舒适"];

const MATRIX: Cell[][] = [
	[
		{ label: "防御抵触", desc: "回避 / 短句回复", level: "alarm" },
		{ label: "焦虑不安", desc: "谨慎 / 反复确认", level: "warning" },
		{ label: "放松友好", desc: "愿意配合", level: "success" },
	],
	[
		{ label: "沉默回避", desc: "不愿展开", level: "muted" },
		{ label: "正常配合", desc: "中性叙述", level: "info" },
		{ label: "开放信任", desc: "主动补充细节", level: "success" },
	],
	[
		{ label: "抵触警觉", desc: "反问与质疑", level: "alarm" },
		{ label: "缓慢接纳", desc: "逐步建立关系", level: "warning" },
		{ label: "开放信任", desc: "主动分享病史", level: "success" },
	],
];

export default function EmotionMatrix() {
	const [active, setActive] = useState({ x: 1, y: 1 });
	const cell = useMemo(() => MATRIX[active.y][active.x], [active]);

	return (
		<div className="group relative overflow-hidden rounded-3xl border border-border/60 bg-card p-6">
			<div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(236,72,153,0.10),transparent_40%),radial-gradient(circle_at_bottom_right,rgba(13,148,136,0.08),transparent_36%)]" />
			<div className="relative z-10 flex items-center justify-between gap-4">
				<div>
					<div className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">情绪二维模型</div>
					<div className="mt-1 text-lg font-bold text-foreground">信任 × 舒适</div>
				</div>
				<div className="rounded-full border border-border/70 bg-background/70 px-3 py-1 text-xs font-medium text-muted-foreground">
					hover / tap
				</div>
			</div>

			<div className="relative z-10 mt-6 grid gap-3">
				<div className="grid grid-cols-[72px_repeat(3,minmax(0,1fr))] gap-2 text-[11px] uppercase tracking-[0.24em] text-muted-foreground">
					<div />
					{X_AXIS.map((axis) => (
						<div key={axis} className="px-2 text-center">{axis}</div>
					))}
				</div>
				{MATRIX.map((row, y) => (
					<div key={Y_AXIS[y]} className="grid grid-cols-[72px_repeat(3,minmax(0,1fr))] gap-2">
						<div className="flex items-center justify-end pr-2 text-[11px] uppercase tracking-[0.24em] text-muted-foreground">
							{Y_AXIS[y]}
						</div>
						{row.map((item, x) => {
							const activeCell = active.x === x && active.y === y;
							return (
								<button
									key={item.label}
									type="button"
									onMouseEnter={() => setActive({ x, y })}
									onFocus={() => setActive({ x, y })}
									onClick={() => setActive({ x, y })}
									className={cn(
										"relative overflow-hidden rounded-2xl border p-4 text-left transition-all duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
										activeCell
											? "scale-[1.03] border-primary/35 bg-primary/10 shadow-lg shadow-primary/10"
											: "border-border/60 bg-background/70 hover:-translate-y-1 hover:border-primary/20",
									)}
								>
									<div className={cn("absolute inset-x-0 top-0 h-0.5 opacity-70", item.level === "success" && "bg-emerald-500", item.level === "warning" && "bg-amber-500", item.level === "alarm" && "bg-rose-500", item.level === "info" && "bg-cyan-500", item.level === "muted" && "bg-border")} />
									<div className="text-sm font-bold text-foreground">{item.label}</div>
									<div className="mt-1 text-xs leading-relaxed text-muted-foreground">{item.desc}</div>
								</button>
							);
						})}
					</div>
				))}
			</div>

			<div className="relative z-10 mt-6 rounded-2xl border border-border/60 bg-background/70 p-5 backdrop-blur-sm">
				<div className="flex items-center justify-between gap-4">
					<div>
						<div className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">当前状态</div>
						<div className="mt-1 text-xl font-bold text-foreground">{cell.label}</div>
					</div>
					<div className="rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">{cell.desc}</div>
				</div>
			</div>
		</div>
	);
}
