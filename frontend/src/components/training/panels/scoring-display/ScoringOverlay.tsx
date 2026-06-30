import { Brain, Loader2 } from "lucide-react";
import { useEffect, useRef, useState, } from "react";
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

interface ThoughtItem {
	dimName: string;
	itemName: string;
	score: number;
	max: number;
	evidence: string;
	reason: string;
}

function parseThoughtItems(thought: string | undefined): ThoughtItem[] {
	if (!thought) return [];
	try {
		const data = JSON.parse(thought) as Record<string, unknown>;
		const dims = data.detail_scores as Record<string, Record<string, unknown>> | undefined;
		if (!dims) return [];
		const items: ThoughtItem[] = [];
		for (const [dimName, dimData] of Object.entries(dims)) {
			if (!dimData || typeof dimData !== "object") continue;
			const dimItems = dimData.items as Array<Record<string, unknown>> | undefined;
			if (!dimItems) continue;
			for (const item of dimItems) {
				const rawMax = Number(item.max);
				const max = Number.isFinite(rawMax) && rawMax > 0 ? rawMax : 3;
				const rawScore = Number(item.score ?? 0);
				const score = Number.isFinite(rawScore) ? rawScore : 0;
				items.push({
					dimName,
					itemName: String(item.name ?? "?"),
					score,
					max,
					evidence: String(item.evidence ?? "").trim(),
					reason: String(item.reason ?? "").trim(),
				});
			}
		}
		return items;
	} catch {
		return [];
	}
}

export function ScoringOverlay({
	bus,
	getProgress,
	subscribeProgress,
}: {
	bus: MessageBus;
	getProgress: () => Progress;
	subscribeProgress: (fn: () => void) => () => void;
}) {
	const [visible, setVisible] = useState(false);
	const [closing, setClosing] = useState(false);
	const [progress, setProgress] = useState<Progress>({
		phase: null,
		percentage: 0,
		message: "",
	});

	const scoreScrollRef = useRef<HTMLDivElement>(null);
	const feedbackScrollRef = useRef<HTMLDivElement>(null);

	// Auto-scroll both panels to bottom when thought content changes
	useEffect(() => {
		if (scoreScrollRef.current) {
			scoreScrollRef.current.scrollTop = scoreScrollRef.current.scrollHeight;
		}
		if (feedbackScrollRef.current) {
			feedbackScrollRef.current.scrollTop = feedbackScrollRef.current.scrollHeight;
		}
	}, [progress.score_thought, progress.feedback_thought]);

	useEffect(() => {
		const unsub = bus.on("training:ended", () => {
			setVisible(true);
			setClosing(false);
		});
		return unsub;
	}, [bus]);

	// Subscribe to ScoreManager for push-based updates (replaces polling)
	const getProgressRef = useRef(getProgress);
	getProgressRef.current = getProgress;

	useEffect(() => {
		if (!visible) return;

		// Immediate first read
		setProgress(getProgressRef.current());

		const unsub = subscribeProgress(() => {
			const p = getProgressRef.current();
			setProgress(p);
			if (p.phase === "completed") {
				setClosing(true);
				setTimeout(() => setVisible(false), 800);
			}
		});

		return unsub;
	}, [visible, subscribeProgress]);

	if (!visible) return null;

	const phaseText = progress.phase
		? phaseLabels[progress.phase] || progress.phase
		: "";
	const isActive =
		progress.phase !== "completed" && progress.phase !== "failed";
	const isFailed = progress.phase === "failed";
	const stuck = isActive && !!progress.thought && progress.percentage > 10;

	return (
		<div
			className={cn(
				"fixed inset-0 z-40 flex items-center justify-center bg-background/80",
				!closing && "animate-in fade-in-0",
				closing && "animate-out fade-out-0",
				"duration-300",
			)}
		>
			<div
				className={cn(
					"w-full max-w-sm mx-4 rounded-xl border border-border bg-card p-5 shadow-lg",
					!closing && "animate-in zoom-in-95 fade-in-0",
					closing && "animate-out zoom-out-95 fade-out-0",
					"duration-300",
				)}
			>
				{/* Header */}
				<div className="flex items-center gap-3 mb-4">
					<div
						className={cn(
							"flex size-9 shrink-0 items-center justify-center rounded-full",
							isFailed
								? "bg-destructive/10 text-destructive"
								: "bg-primary/10 text-primary",
						)}
					>
						{isActive ? (
							<Loader2 className="size-4 animate-spin" />
						) : (
							<Brain className="size-4" />
						)}
					</div>
					<div className="min-w-0">
						<p className="text-sm font-semibold truncate">
							{isActive
								? "正在评估训练表现"
								: isFailed
									? "评估失败"
									: "评估完成"}
						</p>
						<p className="text-xs text-muted-foreground">
							{phaseText} · {progress.percentage}%
						</p>
					</div>
				</div>

				{/* Progress bar */}
				<div className="h-1.5 w-full rounded-full bg-muted overflow-hidden mb-3">
					<div
						className={cn(
							"h-full rounded-full transition-all duration-500 ease-out",
							isFailed ? "bg-destructive" : "bg-primary",
						)}
						style={{ width: `${Math.max(4, progress.percentage)}%` }}
					/>
				</div>

				{/* Dual AI thought panels — scoring (left) + feedback (right) */}
				<div className="grid grid-cols-2 gap-2">
					{/* Score stage column */}
					<div className="rounded-md border border-border/60 bg-muted/30 px-2 py-1.5 overflow-hidden">
						<div className="text-[10px] font-mono text-primary/70 mb-1">$ scoring_dimensions</div>
						<div
							ref={scoreScrollRef}
							className="max-h-30 overflow-y-auto text-[10px] leading-relaxed font-mono text-muted-foreground [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]"
						>
							{progress.score_thought ? (
								(() => {
									const items = parseThoughtItems(progress.score_thought);
									if (items.length > 0) {
										return items.map((item, i) => (
											<div key={i} className="text-foreground/70 py-0.5">
												<span className="text-primary/60">{item.dimName}</span> › {item.itemName}{" "}
												<span className="text-primary/60">({item.score}/{item.max})</span>
											</div>
										));
									}
									return <p className="text-foreground/60 whitespace-pre-wrap break-all">{progress.score_thought!.slice(0, 600)}</p>;
								})()
							) : progress.phase === "scoring" ? (
								<p className="text-muted-foreground/50 animate-pulse">▎ 分析中...</p>
							) : (
								<p className="text-muted-foreground/50">等待评分...</p>
							)}
						</div>
					</div>

					{/* Feedback stage column */}
					<div className="rounded-md border border-border/60 bg-muted/30 px-2 py-1.5 overflow-hidden">
						<div className="text-[10px] font-mono text-primary/70 mb-1">$ feedback_generation</div>
						<div
							ref={feedbackScrollRef}
							className="max-h-30 overflow-y-auto text-[10px] leading-relaxed font-mono text-muted-foreground [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]"
						>
							{progress.feedback_thought ? (
								(() => {
									try {
										const fb = JSON.parse(progress.feedback_thought) as Record<string, unknown>;
										const items = [...(fb.strengths as string[] || []), ...(fb.weaknesses as string[] || [])];
										if (items.length > 0) {
											return items.slice(0, 8).map((s: string, i: number) => (
												<div key={i} className="text-foreground/70 py-0.5">+ {s}</div>
											));
										}
									} catch { /* parse failed — show raw streaming text below */ }
									return <p className="text-foreground/60 whitespace-pre-wrap break-all">{progress.feedback_thought!.slice(0, 600)}</p>;
								})()
							) : progress.phase === "feedback" ? (
								<p className="text-muted-foreground/50 animate-pulse">▎ 生成中...</p>
							) : (
								<p className="text-muted-foreground/50">等待反馈...</p>
							)}
						</div>
					</div>
				</div>

				{/* Error */}
				{isFailed && progress.message && (
					<div className="mt-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2">
						<p className="text-xs text-destructive whitespace-pre-wrap">
							{progress.message}
						</p>
					</div>
				)}

				{/* Footer */}
				{(isFailed || stuck) && (
					<div className="mt-3 flex justify-end">
						<button
							type="button"
							onClick={() => {
								setClosing(true);
								setTimeout(() => setVisible(false), 200);
							}}
							className="rounded-md bg-secondary px-3 py-1 text-xs font-medium hover:bg-secondary/80 transition-colors"
						>
							{isFailed ? "关闭" : "后台继续"}
						</button>
					</div>
				)}
			</div>
		</div>
	);
}
