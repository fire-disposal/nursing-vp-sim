import { useCallback, useEffect, useRef, useState } from "react";
import { Brain, CheckCircle2, Loader2 } from "lucide-react";
import { cn } from "@/utils/cn";

const SCORE_ITEMS = [
	"→ 加载评分标准 v3.2 ...",
	"→ 匹配 Rubric: 护理沟通能力量表",
	"→ 解析对话轮次：共 18 轮",
	"→ 识别有效沟通 14 轮（77.8%）",
	"→ 开放性问题 5 个，闭合性 12 个",
	"→ 检查共情表达模式...",
	"→ 第 3 轮：自我介绍 ✓ 得分",
	"→ 第 4 轮：开放提问 ✓ 得分",
	"→ 第 6 轮：闭合提问偏多 ⚠",
	"→ 第 8 轮：共情回应 '我理解' ✓",
	"→ 第 9-11 轮：缺少共情 ⚠",
	"→ 第 12 轮：追问家族史 ✓ 得分",
	"→ 第 14 轮：过渡衔接自然 ✓",
	"→ 第 16 轮：患者防御情绪检测...",
	"→ 现病史覆盖：5/5 ✓",
	"→ 既往史覆盖：3/3 ✓",
	"→ 家族史覆盖：1/3 ⚠ 缺失",
	"→ 过敏史覆盖：3/3 ✓",
	"→ 生成 19 维度评估报告...",
];

const FEEDBACK_ITEMS = [
	"+ 共采集 5 个核心病史维度，完整性优秀",
	"+ 问诊开场结构清晰，建立了良好信任关系",
	"+ 在患者提及家族病史时及时追问，捕捉关键信息",
	"- 闭合性问题占比偏高（12/17），建议增加开放提问",
	"- 第 4-6 轮缺少共情回应，可能导致患者防御情绪",
	"- 未询问患者心理状态与情绪变化",
];

function useLoopingQueue(items: string[], active: boolean, baseDelay = 800) {
	const [lines, setLines] = useState<string[]>([]);
	const idxRef = useRef(0);
	const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const activeRef = useRef(active);
	activeRef.current = active;

	const tick = useCallback(() => {
		if (!activeRef.current) return;
		setLines((prev) => {
			const next = [...prev, items[idxRef.current]];
			idxRef.current = (idxRef.current + 1) % items.length;
			if (prev.length > 20) return next.slice(-16);
			return next;
		});
		const jitter = baseDelay * (0.4 + Math.random() * 1.2);
		timerRef.current = setTimeout(tick, jitter);
	}, [items, baseDelay]);

	useEffect(() => {
		if (active) {
			setLines([]);
			idxRef.current = 0;
			timerRef.current = setTimeout(tick, 400);
		}
		return () => {
			if (timerRef.current) clearTimeout(timerRef.current);
		};
	}, [active, tick]);

	return lines;
}

export default function ScoreStream() {
	const [phase, setPhase] = useState<"scoring" | "feedback" | "complete">("scoring");
	const [percentage, setPercentage] = useState(0);
	const phaseRef = useRef(phase);
	phaseRef.current = phase;
	const cycleRef = useRef(0);

	useEffect(() => {
		const run = () => {
			cycleRef.current += 1;
			const cyc = cycleRef.current;
			setPercentage(0);
			setPhase("scoring");

			const pTimer = setInterval(() => {
				setPercentage((p) => {
					if (p < 40) return p + 1;
					if (p < 80) return p + 0.5;
					if (p < 99) return p + 0.2;
					return p;
				});
			}, 350);

			const t1 = setTimeout(() => { if (cycleRef.current === cyc) setPhase("feedback"); }, 5000);
			const t2 = setTimeout(() => { if (cycleRef.current === cyc) setPhase("complete"); }, 11000);
			const t3 = setTimeout(() => {
				if (cycleRef.current === cyc) {
					clearInterval(pTimer);
					run();
				}
			}, 14000);

			return () => {
				clearInterval(pTimer);
				clearTimeout(t1);
				clearTimeout(t2);
				clearTimeout(t3);
			};
		};

		const cleanup = run();
		return cleanup;
	}, []);

	const scoreLines = useLoopingQueue(SCORE_ITEMS, phase === "scoring", 900);
	const feedbackLines = useLoopingQueue(FEEDBACK_ITEMS, phase !== "scoring", 1400);

	const phaseText = phase === "scoring" ? "正在评分维度分析" : phase === "feedback" ? "正在生成反馈建议" : "评分完成";
	const scoreProgress = phase === "complete" ? 100 : Math.round(percentage);

		return (
		<div className="group relative flex min-h-[460px] flex-col overflow-hidden rounded-3xl border border-border/60 bg-card p-6 shadow-[0_24px_80px_-40px_rgba(15,23,42,0.55)]">
			<div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(13,148,136,0.10),transparent_35%),radial-gradient(circle_at_bottom_right,rgba(59,130,246,0.06),transparent_34%)]" />

			<div className="relative z-10 flex items-center justify-between gap-4">
				<div>
					<div className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">流式评分</div>
					<div className="mt-1 text-lg font-bold text-foreground">AI 思考 · 逐项证据回传</div>
				</div>
				<div className="flex items-center gap-2 rounded-full border border-border/70 bg-background/70 px-3 py-1 text-xs font-medium text-muted-foreground">
					<span className={cn("size-1.5 rounded-full", phase === "complete" ? "bg-emerald-500" : "bg-primary animate-pulse")} />
					SSE live
				</div>
			</div>

			<div className="relative z-10 mt-5 flex items-center gap-3">
				<div className={cn("flex size-8 shrink-0 items-center justify-center rounded-full", phase === "complete" ? "bg-emerald-500/10 text-emerald-500" : "bg-primary/10 text-primary")}>
					{phase !== "complete" ? (
						<Loader2 className="size-3.5 animate-spin" />
					) : (
						<CheckCircle2 className="size-3.5" />
					)}
				</div>
				<div className="min-w-0 flex-1">
					<div className="flex items-center justify-between gap-2">
						<p className="text-sm font-semibold">{phase !== "complete" ? "正在评估训练表现" : "评估完成"}</p>
						<span className="text-xs tabular-nums text-muted-foreground">{scoreProgress}%</span>
					</div>
					<div className="mt-1.5 h-1.5 w-full rounded-full bg-muted overflow-hidden">
						<div
							className={cn(
								"h-full rounded-full transition-all duration-500 ease-out",
								phase === "complete" ? "bg-emerald-500 shadow-[0_0_12px_rgba(16,185,129,0.4)]" : "bg-primary",
							)}
							style={{ width: `${Math.max(4, scoreProgress)}%` }}
						/>
					</div>
				</div>
			</div>

			<div className="relative z-10 mt-4 flex-1 grid grid-cols-2 gap-2 min-h-0">
				<div className="flex flex-col rounded-md border border-border/60 bg-muted/30 px-2 py-1.5 overflow-hidden">
					<div className="text-[10px] font-mono text-primary/70 mb-1 shrink-0">$ scoring_dimensions</div>
					<div className="flex-1 overflow-y-auto text-[10px] leading-relaxed font-mono text-muted-foreground [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
						{scoreLines.map((item, i) => (
							<div key={`${i}-${item.slice(0, 12)}`} className="text-foreground/70 py-0.5">{item}</div>
						))}
						{scoreLines.length === 0 && (
							<p className="text-muted-foreground/50 animate-pulse">▎ 初始化中...</p>
						)}
					</div>
				</div>

				<div className="flex flex-col rounded-md border border-border/60 bg-muted/30 px-2 py-1.5 overflow-hidden">
					<div className="text-[10px] font-mono text-primary/70 mb-1 shrink-0">$ feedback_generation</div>
					<div className="flex-1 overflow-y-auto text-[10px] leading-relaxed font-mono text-muted-foreground [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
						{feedbackLines.map((item, i) => (
							<div key={`${i}-${item.slice(0, 12)}`} className="text-foreground/70 py-0.5">{item}</div>
						))}
						{feedbackLines.length === 0 && (
							<p className="text-muted-foreground/50">等待评分完成...</p>
						)}
					</div>
				</div>
			</div>
		</div>
	);
}
