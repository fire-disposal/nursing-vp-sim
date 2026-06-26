import { useEffect, useRef, useState } from "react";
import type { EmotionState } from "@/engine";
import {
	EMOTION_LABELS,
	getEmotionColor,
	useEmotion,
} from "@/engine";
import type { MessageBus } from "@/engine/types";
import { cn } from "@/utils/cn";

interface EmotionIndicatorProps {
	bus: MessageBus;
	features: Record<string, boolean>;
}

const EMOTION_ICONS: Record<EmotionState, string> = {
	withdrawn: "😐",
	defensive: "😟",
	anxious: "😰",
	neutral: "🙂",
	relaxed: "😊",
	open: "😄",
};

const EMOTION_DOT: Record<EmotionState, string> = {
	withdrawn: "bg-red-500",
	defensive: "bg-orange-500",
	anxious: "bg-purple-500",
	neutral: "bg-muted-foreground",
	relaxed: "bg-blue-500",
	open: "bg-green-500",
};

const VALUE_BAR_COLOR: Record<EmotionState, string> = {
	withdrawn: "bg-red-500",
	defensive: "bg-orange-500",
	anxious: "bg-purple-500",
	neutral: "bg-muted-foreground/50",
	relaxed: "bg-blue-500",
	open: "bg-green-500",
};

export function EmotionIndicator({ bus, features }: EmotionIndicatorProps) {
	const { emotion } = useEmotion();
	const [values, setValues] = useState({ trust: 50, comfort: 50 });
	const [pulse, setPulse] = useState(false);
	const pulseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	useEffect(() => {
		const unsub = bus.on(
			"emotion:changed",
			(data: { state: string; trust: number; comfort: number }) => {
				setValues({ trust: data.trust, comfort: data.comfort });
				setPulse(true);
				if (pulseTimerRef.current) clearTimeout(pulseTimerRef.current);
				pulseTimerRef.current = setTimeout(() => setPulse(false), 1200);
			},
		);
		return unsub;
	}, [bus]);

	if (!features.emotion) return null;

	return (
		<div
			className={cn(
				"overflow-hidden transition-all duration-300 shrink-0",
				pulse && "bg-primary/5",
			)}
		>
			<div className="flex items-center gap-2 sm:gap-3 px-3 sm:px-4 py-2 border-b border-border">
				<div className="flex items-center gap-1.5 shrink-0">
					<span className="text-sm sm:text-base">{EMOTION_ICONS[emotion]}</span>
					<span className={cn("text-xs sm:text-sm font-semibold", getEmotionColor(emotion))}>
						{EMOTION_LABELS[emotion]}
					</span>
					<span className={cn("size-1.5 sm:size-2 rounded-full", EMOTION_DOT[emotion])} />
				</div>

				<div className="flex-1 flex items-center gap-2 sm:gap-3 min-w-0">
					<div className="flex-1 flex items-center gap-1.5 min-w-0">
						<span className="text-[10px] text-muted-foreground shrink-0">信任</span>
						<div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
							<div
								className={cn("h-full rounded-full transition-all duration-700 ease-out", VALUE_BAR_COLOR[emotion])}
								style={{ width: `${Math.max(0, Math.min(100, values.trust))}%` }}
							/>
						</div>
						<span className="text-[10px] text-muted-foreground tabular-nums w-6 text-right shrink-0">
							{Math.round(values.trust)}
						</span>
					</div>
					<div className="flex-1 flex items-center gap-1.5 min-w-0">
						<span className="text-[10px] text-muted-foreground shrink-0">舒适</span>
						<div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
							<div
								className={cn("h-full rounded-full transition-all duration-700 ease-out", VALUE_BAR_COLOR[emotion])}
								style={{ width: `${Math.max(0, Math.min(100, values.comfort))}%` }}
							/>
						</div>
						<span className="text-[10px] text-muted-foreground tabular-nums w-6 text-right shrink-0">
							{Math.round(values.comfort)}
						</span>
					</div>
				</div>
			</div>
		</div>
	);
}
