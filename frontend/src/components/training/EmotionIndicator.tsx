import { useEffect, useRef, useState } from "react";
import type { EmotionState } from "@/engine/PluginContext";
import {
	EMOTION_LABELS,
	getEmotionColor,
	useEmotion,
} from "@/engine/PluginContext";
import type { MessageBus } from "@/engine/types";
import { cn } from "@/lib/utils";

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

export function EmotionIndicator({ bus, features }: EmotionIndicatorProps) {
	const { emotion } = useEmotion();
	const [values, setValues] = useState({ trust: 50, comfort: 50 });
	const [pulse, setPulse] = useState(false);
	const pulseTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

	useEffect(() => {
		const unsub = bus.on(
			"emotion:changed",
			(data: { state: string; trust: number; comfort: number }) => {
				setValues({ trust: data.trust, comfort: data.comfort });
				setPulse(true);
				if (pulseTimerRef.current) clearTimeout(pulseTimerRef.current);
				pulseTimerRef.current = setTimeout(() => setPulse(false), 1000);
			},
		);
		return unsub;
	}, [bus]);

	if (!features.emotion) return null;

	return (
		<div
			className={cn(
				"flex items-center gap-3 px-4 py-1.5 border-b border-border transition-colors duration-300 shrink-0",
				pulse && "bg-primary/5",
			)}
		>
			<div className="flex items-center gap-1.5">
				<span className="text-sm">{EMOTION_ICONS[emotion]}</span>
				<span className={cn("text-xs font-medium", getEmotionColor(emotion))}>
					{EMOTION_LABELS[emotion]}
				</span>
				<span className={cn("size-2 rounded-full", EMOTION_DOT[emotion])} />
			</div>
			<div className="flex items-center gap-3 ml-auto text-[10px] text-muted-foreground tabular-nums">
				<span>信任 {Math.round(values.trust)}</span>
				<span>舒适 {Math.round(values.comfort)}</span>
			</div>
		</div>
	);
}
