import { Brain, Loader2, RotateCcw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useToast } from "@/components/Toast";
import type { MessageBus, ScorePhase } from "@/engine/types";
import { cn } from "@/utils/cn";

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
	score_thought?: string;
	feedback_thought?: string;
}

export function ScoringOverlay({
	bus,
	getProgress,
	subscribeProgress,
	onRetry,
}: {
	bus: MessageBus;
	getProgress: () => Progress;
	subscribeProgress: (fn: () => void) => () => void;
	onRetry?: () => Promise<void>;
}) {
	const [visible, setVisible] = useState(false);
	const [closing, setClosing] = useState(false);
	const [retrying, setRetrying] = useState(false);
	const [showThought, setShowThought] = useState(true);
	const [progress, setProgress] = useState<Progress>({ phase: null, percentage: 0, message: "" });

	const scoreScrollRef = useRef<HTMLDivElement>(null);
	const feedbackScrollRef = useRef<HTMLDivElement>(null);
	const toast = useToast();
	const navigate = useNavigate();

	useEffect(() => {
		if (scoreScrollRef.current) scoreScrollRef.current.scrollTop = scoreScrollRef.current.scrollHeight;
		if (feedbackScrollRef.current) feedbackScrollRef.current.scrollTop = feedbackScrollRef.current.scrollHeight;
	}, [progress.score_thought, progress.feedback_thought]);

	useEffect(() => {
		const unsub = bus.on("training:ended", () => { setVisible(true); setClosing(false); });
		return unsub;
	}, [bus]);

	const getProgressRef = useRef(getProgress);
	getProgressRef.current = getProgress;

	useEffect(() => {
		if (!visible) return;
		setProgress(getProgressRef.current());
		const unsub = subscribeProgress(() => {
			const p = getProgressRef.current();
			setProgress(p);
			if (p.phase === "completed") { setClosing(true); setTimeout(() => setVisible(false), 800); }
		});
		return unsub;
	}, [visible, subscribeProgress]);

	if (!visible) return null;

	const phaseText = progress.phase ? phaseLabels[progress.phase] || progress.phase : "";
	const isActive = progress.phase !== "completed" && progress.phase !== "failed";
	const isFailed = progress.phase === "failed";

	const handleRetry = async () => {
		if (!onRetry || retrying) return;
		setRetrying(true);
		try { await onRetry(); } catch { /* toast handled by caller */ }
		finally { setRetrying(false); }
	};

	return (
		<div className={cn("fixed inset-0 z-40 flex items-center justify-center bg-background/80", !closing && "animate-in fade-in-0", closing && "animate-out fade-out-0", "duration-300")}>
			<div className={cn("w-full max-w-sm mx-4 rounded-xl border border-border bg-card p-5 shadow-lg", !closing && "animate-in zoom-in-95 fade-in-0", closing && "animate-out zoom-out-95 fade-out-0", "duration-300")}>
				{/* Header */}
				<div className="flex items-center gap-3 mb-4">
					<div className={cn("flex size-9 shrink-0 items-center justify-center rounded-full", isFailed ? "bg-destructive/10 text-destructive" : "bg-primary/10 text-primary")}>
						{isActive ? <Loader2 className="size-4 animate-spin" /> : <Brain className="size-4" />}
					</div>
					<div className="min-w-0">
						<p className="text-sm font-semibold truncate">{isActive ? "正在评估训练表现" : isFailed ? "评估失败" : "评估完成"}</p>
						<p className="text-xs text-muted-foreground">{phaseText} · {progress.percentage}%</p>
					</div>
				</div>

				{/* Progress bar */}
				<div className="h-1.5 w-full rounded-full bg-muted overflow-hidden mb-3">
					<div className={cn("h-full rounded-full transition-all duration-500 ease-out", isFailed ? "bg-destructive" : "bg-primary")}
						style={{ width: `${Math.max(4, progress.percentage)}%` }} />
				</div>

				{/* AI thought — expanded by default for entertainment while waiting */}
				{isActive && (progress.score_thought || progress.feedback_thought) && (
					<div className="mb-3">
						<button type="button" onClick={() => setShowThought((v) => !v)}
							className="text-[10px] text-muted-foreground hover:text-foreground transition-colors">
							{showThought ? "▲ 收起" : "▼ 展开"} AI 实时分析
						</button>
						{showThought && (
							<div className="grid grid-cols-2 gap-2 mt-1">
								<div className="rounded-md border border-border/60 bg-muted/30 px-2 py-1.5">
									<div className="text-[10px] font-mono text-primary/70 mb-1">$ scoring_dims</div>
									<div ref={scoreScrollRef} className="max-h-32 overflow-y-auto text-[10px] leading-relaxed font-mono text-muted-foreground [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
										{progress.score_thought ? <p className="text-foreground/70 whitespace-pre-wrap break-all">{progress.score_thought}</p> : <p className="text-muted-foreground/50 animate-pulse">▎ 等待评分维度分析...</p>}
									</div>
								</div>
								<div className="rounded-md border border-border/60 bg-muted/30 px-2 py-1.5">
									<div className="text-[10px] font-mono text-primary/70 mb-1">$ feedback_gen</div>
									<div ref={feedbackScrollRef} className="max-h-32 overflow-y-auto text-[10px] leading-relaxed font-mono text-muted-foreground [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
										{progress.feedback_thought ? <p className="text-foreground/70 whitespace-pre-wrap break-all">{progress.feedback_thought}</p> : <p className="text-muted-foreground/50 animate-pulse">▎ 等待反馈生成...</p>}
									</div>
								</div>
							</div>
						)}
					</div>
				)}

				{/* Error */}
				{isFailed && progress.message && (
					<div className="mb-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2">
						<p className="text-xs text-destructive whitespace-pre-wrap">{progress.message}</p>
						{onRetry && (
							<button type="button" onClick={handleRetry} disabled={retrying}
								className="mt-2 inline-flex items-center gap-1 text-xs text-primary hover:underline">
								{retrying ? <Loader2 className="size-3 animate-spin" /> : <RotateCcw size={12} />}
								重试评分
							</button>
						)}
					</div>
				)}

				{/* Footer */}
				{isActive && (
					<div className="mt-3 flex items-center justify-between gap-3">
						<p className="text-[11px] text-muted-foreground leading-tight">评分完成后自动跳转结果页，<br />也可提前返回训练选择</p>
						<button type="button" onClick={() => { setClosing(true); setTimeout(() => { setVisible(false); navigate("/training"); }, 200); }}
							className="shrink-0 rounded-md border border-border px-2.5 py-1 text-[11px] text-muted-foreground hover:bg-muted transition-colors">
							返回训练选择
						</button>
					</div>
				)}
			</div>
		</div>
	);
}
