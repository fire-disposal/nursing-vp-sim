import { useEffect, useRef, useState } from "react";
import type { MessageBus, ScorePhase } from "@/engine/types";
import { cn } from "@/lib/utils";

const phaseLabels: Record<string, string> = {
	loading: "正在加载对话记录...",
	scoring: "正在评分维度分析",
	feedback: "正在生成反馈建议",
	saving: "正在保存评分结果...",
	completed: "评分完成 ✓",
	failed: "评分失败",
	processing: "评分处理中...",
};

interface Progress {
	phase: ScorePhase;
	percentage: number;
	message: string;
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

	useEffect(() => {
		const unsub = bus.on("training:ended", () => {
			setVisible(true);
		});
		return unsub;
	}, [bus]);

	const getProgressRef = useRef(getProgress);
	getProgressRef.current = getProgress;

	useEffect(() => {
		if (!visible) return;
		const hideTimerRef = { current: null as ReturnType<typeof setTimeout> | null };
		const id = setInterval(() => {
			const p = getProgressRef.current();
			setProgress(p);
			if (p.phase === "completed" || p.phase === "failed") {
				if (!hideTimerRef.current) {
					hideTimerRef.current = setTimeout(() => {
						setClosing(true);
						setTimeout(() => setVisible(false), 200);
					}, 1500);
				}
			}
		}, 200);
		return () => {
			clearInterval(id);
			if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
		};
	}, [visible]);

	if (!visible) return null;

	const phaseText = progress.phase
		? phaseLabels[progress.phase] || progress.phase
		: "";

	return (
		<div
			className={cn(
				"fixed inset-0 z-40 flex flex-col items-center justify-center bg-background/90",
				!closing && "animate-in fade-in-0",
				closing && "animate-out fade-out-0",
				"duration-300",
			)}
		>
			<p className="mb-4 text-lg font-medium">正在评估训练表现...</p>
			<div className="h-2 w-64 rounded-full bg-muted">
				<div
					className="h-full rounded-full bg-primary transition-all duration-300"
					style={{ width: `${progress.percentage}%` }}
				/>
			</div>
			<p className="mt-2 text-sm text-muted-foreground">
				{phaseText}
				{progress.phase !== "completed" && progress.phase !== "failed"
					? ` (${progress.percentage}%)`
					: ""}
			</p>
			{progress.phase === "failed" && progress.message && (
				<p className="mt-1 text-xs text-red-500">{progress.message}</p>
			)}
		</div>
	);
}
