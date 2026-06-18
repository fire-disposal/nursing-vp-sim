import { useEffect, useState } from "react";
import type { EmotionState } from "@/engine/PluginContext";
import {
	EMOTION_LABELS,
	getEmotionColor,
	useEmotion,
} from "@/engine/PluginContext";
import type { PanelTabProps } from "@/engine/types";
import { cn } from "@/lib/utils";
import { EmotionTrajectory } from "./EmotionTrajectory";

interface EmotionState2D {
	trust: number;
	comfort: number;
	state: string;
	note: string;
	history?: Array<{
		trust: number;
		comfort: number;
		state: string;
		intent: string;
		timestamp: string;
	}>;
}

export function EmotionTab({ ctx }: PanelTabProps) {
	const { setEmotion } = useEmotion();
	const [history, setHistory] = useState<EmotionState2D["history"]>([]);
	const [data, setData] = useState<EmotionState2D | null>(null);

	const currentState: EmotionState = (data?.state as EmotionState) || "neutral";

	useEffect(() => {
		const unsub = ctx.bus.on(
			"emotion:changed",
			(d: { state: string; trust: number; comfort: number }) => {
				setEmotion(d.state as EmotionState);
				setData((prev) => ({
					...prev,
					trust: d.trust,
					comfort: d.comfort,
					state: d.state,
					note: "",
				}));
			},
		);

		const loadInitial = async () => {
			try {
				const [stateRes, histRes] = await Promise.all([
					fetch(`/api/training/${ctx.recordId}/state`),
					fetch(`/api/training/${ctx.recordId}/emotion/history`),
				]);
				const stateJson = await stateRes.json();
				const histJson = await histRes.json();

				const emo = stateJson.emotion;
				if (emo) {
					setData({
						trust: emo.trust,
						comfort: emo.comfort,
						state: emo.state,
						note: emo.note || "",
					});
					setEmotion(emo.state as EmotionState);
				}
				if (histJson.history) setHistory(histJson.history);
			} catch {
				/* ignore */
			}
		};
		loadInitial();

		return () => {
			unsub();
		};
	}, [ctx.bus, ctx.recordId, setEmotion]);

	const trust = data?.trust ?? 50;
	const comfort = data?.comfort ?? 50;

	return (
		<div className="space-y-4">
			<EmotionTrajectory
				history={history as any}
				current={{ trust, comfort }}
			/>

			<div
				className={cn(
					"text-center p-3 rounded-lg border",
					getEmotionBg(currentState),
				)}
			>
				<div
					className={cn(
						"inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-bold",
						getEmotionColor(currentState),
					)}
				>
					<span
						className={cn("size-2.5 rounded-full", EMOTION_DOT[currentState])}
					/>
					{EMOTION_LABELS[currentState]}
				</div>
			</div>

			<div className="space-y-2">
				<h4 className="text-xs font-semibold text-muted-foreground">
					情绪变化时间线
				</h4>
				{!history || history.length === 0 ? (
					<p className="text-xs text-muted-foreground">暂无情绪变化记录</p>
				) : (
					<div className="space-y-1">
						{history
							.slice(-10)
							.reverse()
							.map((h, i) => {
								const histState: EmotionState =
									(h.state as EmotionState) || "neutral";
								return (
									<div key={i} className="flex items-center gap-2 text-xs py-1">
										<span
											className={cn(
												"size-2 rounded-full shrink-0",
												EMOTION_DOT[histState],
											)}
										/>
										<span className="text-muted-foreground">
											{EMOTION_LABELS[histState]}
										</span>
										<span className="text-muted-foreground/50 ml-auto">
											{h.intent}
										</span>
									</div>
								);
							})}
					</div>
				)}
			</div>
		</div>
	);
}

const EMOTION_BG: Record<EmotionState, string> = {
	withdrawn: "border-red-400 bg-red-50",
	defensive: "border-orange-400 bg-orange-50",
	anxious: "border-purple-400 bg-purple-50",
	neutral: "border-border bg-muted/30",
	relaxed: "border-blue-400 bg-blue-50",
	open: "border-green-400 bg-green-50",
};

const EMOTION_DOT: Record<EmotionState, string> = {
	withdrawn: "bg-red-400",
	defensive: "bg-orange-400",
	anxious: "bg-purple-400",
	neutral: "bg-muted",
	relaxed: "bg-blue-400",
	open: "bg-green-400",
};

function getEmotionBg(state: EmotionState): string {
	return EMOTION_BG[state];
}
