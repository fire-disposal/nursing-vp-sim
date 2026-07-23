import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { triggerInitiative } from "@/api/training";
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
	capabilities: Record<string, boolean>;
	recordId: number;
	compact?: boolean;
	/** 右侧注入位（如问诊进度 chip），与情绪栏共用一条状态栏 */
	trailing?: ReactNode;
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

export function EmotionIndicator({ bus, capabilities, recordId, compact, trailing }: EmotionIndicatorProps) {
	const { emotion } = useEmotion();
	const [trust, setTrust] = useState(50);
	const [_comfort, _setComfort] = useState(50);
	const [pulse, setPulse] = useState(false);
	const [emojiPop, setEmojiPop] = useState(false);
	const prevEmotionRef = useRef(emotion);
	const pulseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const popTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	// ── Initiative state ──
	const [initPercent, setInitPercent] = useState(0);
	const [, setInitCount] = useState(0);
	const maxReachedRef = useRef(false);
	const elapsedRef = useRef(0);
	const thresholdRef = useRef(30);
	const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
	const pollingRef = useRef(false);
	const waitingRef = useRef(false);
	const pausedRef = useRef(false);

	const stopTicker = useCallback(() => {
		if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
	}, []);

	const pollTrigger = useCallback(async () => {
		if (pollingRef.current || maxReachedRef.current) return;
		pollingRef.current = true;
		try {
			const res = await triggerInitiative(recordId);
			if (res.data.triggered && res.data.message) {
				bus.emit("initiative:triggered", { content: res.data.message });
				if (res.data.emotion) {
					bus.emit("emotion:changed", res.data.emotion as { state: string; trust: number; comfort: number });
				}
			}
		} catch { /* ignore */ } finally {
			pollingRef.current = false;
		}
	}, [recordId, bus]);

	const startTicker = useCallback(() => {
		if (tickRef.current) return;
		tickRef.current = setInterval(() => {
			if (maxReachedRef.current || waitingRef.current || pausedRef.current) return;
			elapsedRef.current += 1;
			const pct = Math.min(100, Math.round((elapsedRef.current / thresholdRef.current) * 100));
			setInitPercent(pct);
			if (pct >= 100) pollTrigger();
		}, 1000);
	}, [pollTrigger]);

	const resetInitiativeTimer = useCallback(() => {
		elapsedRef.current = 0;
		setInitPercent(0);
	}, []);

	useEffect(() => {
		const unsub = bus.on("chat:beforeSend", () => {
			resetInitiativeTimer();
			waitingRef.current = true;
		});
		return unsub;
	}, [bus, resetInitiativeTimer]);

	useEffect(() => {
		const unsub = bus.on(
			"initiative:state",
			(data: {
				elapsed_seconds?: number;
				threshold_seconds?: number;
				percent?: number;
				initiative_count?: number;
				max_reached?: boolean;
			}) => {
				if (data.max_reached) {
					maxReachedRef.current = true;
					stopTicker();
					setInitPercent(0);
					return;
				}
				elapsedRef.current = data.elapsed_seconds ?? 0;
				thresholdRef.current = data.threshold_seconds ?? 30;
				setInitPercent(data.percent ?? 0);
				setInitCount(data.initiative_count ?? 0);
				waitingRef.current = false;
				startTicker();
			},
		);
		return unsub;
	}, [bus, startTicker, stopTicker]);

	useEffect(() => {
		const unsubStart = bus.on("tts:start", () => { pausedRef.current = true; });
		const unsubEnd = bus.on("tts:end", () => { pausedRef.current = false; });
		return () => { unsubStart(); unsubEnd(); };
	}, [bus]);

	useEffect(() => {
		return bus.on("training:ended", () => { stopTicker(); });
	}, [bus, stopTicker]);

	useEffect(() => { return () => stopTicker(); }, [stopTicker]);

	const showInitiative = capabilities.patient_initiative && !maxReachedRef.current;

	useEffect(() => {
		const unsub = bus.on(
			"emotion:changed",
			(data: { state: string; trust: number; comfort: number }) => {
				setTrust(data.trust);
				_setComfort(data.comfort);
				setPulse(true);
				if (pulseTimerRef.current) clearTimeout(pulseTimerRef.current);
				pulseTimerRef.current = setTimeout(() => setPulse(false), 1200);
			},
		);
		return unsub;
	}, [bus]);

	// Animate emoji on state transition
	useEffect(() => {
		if (emotion !== prevEmotionRef.current) {
			prevEmotionRef.current = emotion;
			setEmojiPop(true);
			if (popTimerRef.current) clearTimeout(popTimerRef.current);
			popTimerRef.current = setTimeout(() => setEmojiPop(false), 400);
		}
	}, [emotion]);

	if (!capabilities.emotion) return null;

	const label = EMOTION_LABELS[emotion];
	const trustPct = Math.max(0, Math.min(100, trust));

	if (compact) {
		return (
			<div
				className={cn(
					"shrink-0 border-b border-border px-2 py-1.5 transition-colors duration-300",
					pulse && "bg-primary/5",
				)}
			>
				<div className="flex items-center gap-1.5">
					<span
						className={cn(
							"text-sm leading-none transition-transform duration-300",
							emojiPop && "scale-125",
						)}
					>
						{EMOTION_ICONS[emotion]}
					</span>
					<span className="text-[11px] text-muted-foreground truncate">{label}</span>
					<div className="ml-auto flex items-center gap-2">
						{showInitiative && initPercent > 0 && (
							<div className="h-1 w-12 rounded-full bg-muted overflow-hidden shrink-0">
								<div
									className={cn(
										"h-full rounded-full transition-all duration-1000",
										initPercent > 80 ? "bg-danger" : initPercent > 50 ? "bg-warning" : "bg-success",
									)}
									style={{ width: `${Math.min(100, initPercent)}%` }}
								/>
							</div>
						)}
						{trailing}
					</div>
				</div>
			</div>
		);
	}

	return (
		<div
			className={cn(
				"overflow-hidden transition-all duration-300 shrink-0 group",
				pulse && "bg-primary/5",
			)}
		>
			<div className="flex items-center gap-2 sm:gap-3 px-3 sm:px-4 py-2 border-b border-border">
				{/* Emoji + label */}
				<div className="flex items-center gap-1.5 shrink-0">
					<span
						className={cn(
							"text-sm sm:text-base transition-transform duration-300",
							emojiPop && "scale-125",
						)}
					>
						{EMOTION_ICONS[emotion]}
					</span>
					<span className={cn("text-xs sm:text-sm font-semibold", getEmotionColor(emotion))}>
						{label}
					</span>
					<span className={cn("size-1.5 sm:size-2 rounded-full", EMOTION_DOT[emotion])} />
				</div>

				{/* Trust bar — subtle single bar replacing dual bars */}
				<div className="flex-1 flex items-center gap-1.5 min-w-0">
					<div className="flex-1 h-1 sm:h-1.5 rounded-full bg-muted overflow-hidden">
						<div
							className={cn(
								"h-full rounded-full transition-all duration-700 ease-out",
								EMOTION_DOT[emotion],
							)}
							style={{ width: `${trustPct}%` }}
						/>
					</div>
				</div>

				{/* Initiative timer */}
				{showInitiative && initPercent > 0 && (
					<div className="flex items-center gap-1.5 shrink-0" style={{ maxWidth: "120px" }}>
						<span className="text-[10px] text-muted-foreground shrink-0 hidden sm:inline">追问</span>
						<div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden min-w-[40px]">
							<div
								className={cn(
									"h-full rounded-full transition-all duration-1000 ease-linear",
									initPercent > 80 ? "bg-danger" : initPercent > 50 ? "bg-warning" : "bg-success",
								)}
								style={{ width: `${Math.min(100, initPercent)}%` }}
							/>
						</div>
					</div>
				)}
				{trailing}
			</div>
		</div>
	);
}
