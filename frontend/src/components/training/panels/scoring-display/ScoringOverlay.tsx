import { useEffect, useMemo, useRef, useState } from "react";
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

/** Parse raw LLM JSON thought into human-readable dimension names being scored */
function parseThoughtSummary(thought: string | undefined): string[] {
	if (!thought) return [];
	try {
		const data = JSON.parse(thought) as Record<string, unknown>;
		const dims = data.detail_scores as Record<string, unknown> | undefined;
		if (dims) return Object.keys(dims);
	} catch {
		return [];
	}
	return [];
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
	const [showThought, setShowThought] = useState(false);

	useEffect(() => {
		const unsub = bus.on("training:ended", () => {
			setVisible(true);
			setClosing(false);
			setShowThought(false);
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
			// Auto-expand thought when available so student sees AI reasoning
			if (p.thought) setShowThought(true);
			if (p.phase === "completed") {
				clearInterval(id);
				setClosing(true);
				setTimeout(() => setVisible(false), 800);
			}
		}, 200);
		return () => clearInterval(id);
	}, [visible]);

	const thoughtDims = useMemo(() => parseThoughtSummary(progress.thought), [progress.thought]);

	if (!visible) return null;

	const phaseText = progress.phase
		? phaseLabels[progress.phase] || progress.phase
		: "";
	const isActive = progress.phase !== "completed" && progress.phase !== "failed";
	const hasThought = !!progress.thought;

	return (
		<div
			className={cn(
				"fixed inset-0 z-40 flex flex-col items-center justify-center bg-background/90",
				!closing && "animate-in fade-in-0",
				closing && "animate-out fade-out-0",
				"duration-300",
			)}
		>
			<p className="mb-4 text-lg font-medium">
				{isActive ? "正在评估训练表现..." : progress.phase === "completed" ? "评估完成" : "评估失败"}
			</p>

			{/* Progress bar */}
			<div className="h-2 w-64 rounded-full bg-muted">
				<div
					className={cn(
						"h-full rounded-full transition-all duration-300",
						progress.phase === "failed" ? "bg-destructive" : "bg-primary",
					)}
					style={{ width: `${Math.max(2, progress.percentage)}%` }}
				/>
			</div>

			{/* Stage + percentage */}
			<p className="mt-2 text-sm text-muted-foreground">
				{phaseText}
				{isActive ? ` (${progress.percentage}%)` : ""}
			</p>

			{/* Activity message — more prominent */}
			{isActive && progress.message && (
				<p className="mt-2 max-w-md text-center text-xs text-muted-foreground animate-pulse">
					{progress.message}
				</p>
			)}

			{/* AI reasoning section */}
			{hasThought && (
				<div className="mt-4 max-w-lg w-full px-4">
					{thoughtDims.length > 0 && (
						<p className="text-xs text-muted-foreground mb-1">
							正在评分维度：{thoughtDims.join("、")}
						</p>
					)}
					<button
						type="button"
						onClick={() => setShowThought(!showThought)}
						className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
					>
						{showThought ? "隐藏" : "查看"}AI 推理详情
					</button>
					{showThought && (
						<pre className="mt-1 max-h-64 overflow-auto rounded-md border border-border bg-muted/50 p-3 text-xs leading-relaxed whitespace-pre-wrap font-mono">
							{progress.thought}
						</pre>
					)}
				</div>
			)}

			{progress.phase === "failed" && progress.message && (
				<p className="mt-1 max-w-md text-center text-xs text-red-500 whitespace-pre-wrap">{progress.message}</p>
			)}

			<div className="mt-4 flex gap-3">
				{progress.phase === "failed" && (
					<button
						type="button"
						onClick={() => {
							setClosing(true);
							setTimeout(() => setVisible(false), 200);
						}}
						className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium shadow-sm hover:bg-muted transition-colors"
					>
						关闭
					</button>
				)}
			</div>
		</div>
	);
}
