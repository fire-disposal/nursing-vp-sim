import { useEffect, useMemo, useRef, useState } from "react";
import { Brain, ChevronDown, ChevronUp, Loader2 } from "lucide-react";
import type { MessageBus, ScorePhase } from "@/engine/types";
import { cn } from "@/lib/utils";

const phaseLabels: Record<string, string> = {
	loading: "正在加载对话记录...",
	scoring: "正在评分维度分析",
	feedback: "正在生成反馈建议",
	saving: "正在保存评分结果...",
	completed: "评分完成",
	failed: "评分失败",
	processing: "评分处理中...",
};

interface Progress {
	phase: ScorePhase;
	percentage: number;
	message: string;
	thought?: string;
}

function parseThoughtSummary(thought: string | undefined): {
	dimensions: string[];
	totalScore: number | null;
} {
	if (!thought) return { dimensions: [], totalScore: null };
	try {
		const data = JSON.parse(thought) as Record<string, unknown>;
		const dims = data.detail_scores as Record<string, unknown> | undefined;
		const total =
			typeof data.total_score === "number" ? data.total_score : null;
		return {
			dimensions: dims ? Object.keys(dims) : [],
			totalScore: total,
		};
	} catch {
		return { dimensions: [], totalScore: null };
	}
}

function formatThought(thought: string): string {
	try {
		return JSON.stringify(JSON.parse(thought), null, 2);
	} catch {
		return thought;
	}
}

export function ScoringOverlay({
	bus,
	getProgress,
}: {
	bus: MessageBus;
	getProgress: () => Progress;
}) {
	const [visible, setVisible] = useState(false);
	const [closing, setClosing] = useState(false);
	const [progress, setProgress] = useState<Progress>({
		phase: null,
		percentage: 0,
		message: "",
	});
	const [thoughtExpanded, setThoughtExpanded] = useState(false);

	useEffect(() => {
		const unsub = bus.on("training:ended", () => {
			setVisible(true);
			setClosing(false);
			setThoughtExpanded(false);
		});
		return unsub;
	}, [bus]);

	const getProgressRef = useRef(getProgress);
	getProgressRef.current = getProgress;

	useEffect(() => {
		if (!visible) return;
		const id = setInterval(() => {
			const p = getProgressRef.current();
			setProgress(p);
			if (p.thought) setThoughtExpanded(true);
			if (p.phase === "completed") {
				clearInterval(id);
				setClosing(true);
				setTimeout(() => setVisible(false), 800);
			}
		}, 200);
		return () => clearInterval(id);
	}, [visible]);

	const { dimensions, totalScore } = useMemo(
		() => parseThoughtSummary(progress.thought),
		[progress.thought],
	);

	if (!visible) return null;

	const phaseText = progress.phase
		? phaseLabels[progress.phase] || progress.phase
		: "";
	const isActive =
		progress.phase !== "completed" && progress.phase !== "failed";
	const isFailed = progress.phase === "failed";

	return (
		<div
			className={cn(
				"fixed inset-0 z-40 flex items-center justify-center bg-background/80",
				!closing && "animate-in fade-in-0",
				closing && "animate-out fade-out-0",
				"duration-300",
			)}
		>
			{/* Card */}
			<div
				className={cn(
					"w-full max-w-md mx-4 rounded-xl border border-border bg-card p-6 shadow-lg",
					!closing && "animate-in zoom-in-95 fade-in-0",
					closing && "animate-out zoom-out-95 fade-out-0",
					"duration-300",
				)}
			>
				{/* Header */}
				<div className="flex items-center gap-3 mb-5">
					<div
						className={cn(
							"flex size-10 shrink-0 items-center justify-center rounded-full",
							isFailed
								? "bg-destructive/10 text-destructive"
								: "bg-primary/10 text-primary",
						)}
					>
						{isActive ? (
							<Loader2 className="size-5 animate-spin" />
						) : (
							<Brain className="size-5" />
						)}
					</div>
					<div className="min-w-0">
						<p className="truncate text-base font-semibold">
							{isActive
								? "正在评估训练表现"
								: isFailed
									? "评估失败"
									: "评估完成"}
						</p>
						<p className="text-xs text-muted-foreground">
							{phaseText}
							{isActive ? ` · ${progress.percentage}%` : ""}
						</p>
					</div>
				</div>

				{/* Progress bar */}
				<div className="mb-4">
					<div className="h-2.5 w-full rounded-full bg-muted overflow-hidden">
						<div
							className={cn(
								"h-full rounded-full transition-all duration-500 ease-out",
								isFailed ? "bg-destructive" : "bg-primary",
							)}
							style={{
								width: `${Math.max(isActive ? 4 : progress.percentage, progress.percentage)}%`,
							}}
						/>
					</div>
				</div>

				{/* AI reasoning box */}
				{progress.thought && (
					<div className="rounded-lg border border-border bg-muted/30 overflow-hidden">
						{/* Summary bar — always visible */}
						<div className="px-4 py-2.5 flex items-center justify-between">
							<div className="flex items-center gap-2 min-w-0">
								<Brain className="size-3.5 shrink-0 text-primary" />
								<span className="text-xs text-muted-foreground truncate">
									{dimensions.length > 0
										? `评分维度：${dimensions.join("、")}`
										: "AI 推理过程"}
									{totalScore != null && (
										<span className="ml-1 font-mono text-primary">
											· {totalScore} 分
										</span>
									)}
								</span>
							</div>
							<button
								type="button"
								onClick={() => setThoughtExpanded(!thoughtExpanded)}
								className="shrink-0 ml-2 text-muted-foreground hover:text-foreground transition-colors"
							>
								{thoughtExpanded ? (
									<ChevronUp className="size-4" />
								) : (
									<ChevronDown className="size-4" />
								)}
							</button>
						</div>

						{/* Expanded detail */}
						{thoughtExpanded && (
							<pre className="border-t border-border bg-muted/20 px-4 py-3 max-h-56 overflow-auto text-[11px] leading-relaxed whitespace-pre-wrap font-mono text-muted-foreground">
								{formatThought(progress.thought)}
							</pre>
						)}
					</div>
				)}

				{/* Error message */}
				{isFailed && progress.message && (
					<div className="mt-3 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-2.5">
						<p className="text-xs text-destructive whitespace-pre-wrap">
							{progress.message}
						</p>
					</div>
				)}

				{/* Footer */}
				<div className="mt-4 flex items-center justify-between">
					{isActive && !progress.thought && (
						<p className="text-xs text-muted-foreground">
							正在启动 AI 评分引擎...
						</p>
					)}
					{isFailed && (
						<button
							type="button"
							onClick={() => {
								setClosing(true);
								setTimeout(() => setVisible(false), 200);
							}}
							className="ml-auto rounded-md bg-secondary px-4 py-1.5 text-xs font-medium hover:bg-secondary/80 transition-colors"
						>
							关闭
						</button>
					)}
				</div>
			</div>
		</div>
	);
}
