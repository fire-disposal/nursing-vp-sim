import { useCallback, useEffect, useRef, useState } from "react";
import type { MessageBus } from "@/engine/types";
import { triggerInitiative } from "@/api/training-state";
import { cn } from "@/utils/cn";

interface InitiativeBarProps {
	bus: MessageBus;
	features: Record<string, boolean>;
	recordId: number;
}

export function InitiativeBar({ bus, features, recordId }: InitiativeBarProps) {
	const [percent, setPercent] = useState(0);
	const [_maxReached, setMaxReached] = useState(false);
	const elapsedRef = useRef(0);
	const thresholdRef = useRef(30);
	const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
	const pollingRef = useRef(false);
	const waitingRef = useRef(false);
	const pausedRef = useRef(false);
	const maxReachedRef = useRef(false);

	const stopTicker = useCallback(() => {
		if (tickRef.current) {
			clearInterval(tickRef.current);
			tickRef.current = null;
		}
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
		} catch {
		} finally {
			pollingRef.current = false;
		}
	}, [recordId, bus]);

	const startTicker = useCallback(() => {
		if (tickRef.current) return;
		tickRef.current = setInterval(() => {
			if (maxReachedRef.current || waitingRef.current || pausedRef.current) return;
			elapsedRef.current += 1;
			const pct = Math.min(100, Math.round((elapsedRef.current / thresholdRef.current) * 100));
			setPercent(pct);
			if (pct >= 100) {
				pollTrigger();
			}
		}, 1000);
	}, [pollTrigger]);

	const resetTimer = useCallback(() => {
		elapsedRef.current = 0;
		setPercent(0);
	}, []);

	// User sends message → reset timer, wait for patient reply
	useEffect(() => {
		const unsub = bus.on("chat:beforeSend", () => {
			resetTimer();
			waitingRef.current = true;
		});
		return unsub;
	}, [bus, resetTimer]);

	// SSE initiative_state → sync elapsed, start ticking after patient reply
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
					setMaxReached(true);
					stopTicker();
					setPercent(0);
					return;
				}
				elapsedRef.current = data.elapsed_seconds ?? 0;
				thresholdRef.current = data.threshold_seconds ?? 30;
				setPercent(data.percent ?? 0);
				waitingRef.current = false;
				startTicker();
			},
		);
		return unsub;
	}, [bus, startTicker, stopTicker]);

	// Pause during TTS playback
	useEffect(() => {
		const unsubStart = bus.on("tts:start", () => {
			pausedRef.current = true;
		});
		const unsubEnd = bus.on("tts:end", () => {
			pausedRef.current = false;
		});
		return () => {
			unsubStart();
			unsubEnd();
		};
	}, [bus]);

	// Cleanup on training end
	useEffect(() => {
		return bus.on("training:ended", () => {
			stopTicker();
		});
	}, [bus, stopTicker]);

	if (!features.patient_initiative) return null;

	const barColor =
		percent > 80
			? "bg-destructive"
			: percent > 50
				? "bg-amber-500"
				: "bg-green-500";

	return (
		<div className="shrink-0 bg-muted/30 overflow-hidden">
			{percent > 0 && (
				<div className="flex items-center gap-2 px-3 py-1">
					<span className="text-[10px] text-muted-foreground shrink-0">患者等待</span>
					<div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
						<div
							className={cn("h-full rounded-full transition-all duration-1000 ease-linear", barColor)}
							style={{ width: `${Math.min(100, percent)}%` }}
						/>
					</div>
					<span className="text-[10px] text-muted-foreground tabular-nums shrink-0">
						{Math.round(percent)}%
					</span>
				</div>
			)}
		</div>
	);
}
