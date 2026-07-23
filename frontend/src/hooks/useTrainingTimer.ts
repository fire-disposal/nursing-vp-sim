import { useCallback, useEffect, useRef, useState } from "react";
import { useToast } from "@/components/Toast";

interface UseTrainingTimerOptions {
	initialRemaining: number | null;
	onAutoEnd: () => void;
}

export function useTrainingTimer({
	initialRemaining,
	onAutoEnd,
}: UseTrainingTimerOptions) {
	const [remaining, setRemaining] = useState<number | null>(initialRemaining);
	const [timerActive, setTimerActive] = useState(false);
	const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
	const warned5Ref = useRef(false);
	const warned2Ref = useRef(false);
	const autoEndRef = useRef(false);
	const toast = useToast();

	useEffect(() => {
		if (initialRemaining == null) return;
		if (remaining == null || Math.abs((remaining ?? 0) - initialRemaining) > 10) {
			setRemaining(initialRemaining);
		}
		if (initialRemaining > 0 && !timerActive) {
			setTimerActive(true);
		}
		warned5Ref.current = false;
		warned2Ref.current = false;
		autoEndRef.current = initialRemaining <= 0;
	}, [initialRemaining]);

	useEffect(() => {
		if (!timerActive) return;
		timerRef.current = setInterval(() => {
			setRemaining((s) => {
				if (s == null) return s;
				if (s <= 1) {
					if (timerRef.current) clearInterval(timerRef.current);
					return 0;
				}
				return s - 1;
			});
		}, 1000);
		return () => {
			if (timerRef.current) clearInterval(timerRef.current);
		};
	}, [timerActive]);

	useEffect(() => {
		if (remaining == null || !timerActive) return;
		if (remaining <= 300 && remaining > 299 && !warned5Ref.current) {
			warned5Ref.current = true;
			toast.warning("训练时间剩余 5 分钟");
		}
		if (remaining <= 120 && remaining > 119 && !warned2Ref.current) {
			warned2Ref.current = true;
			toast.warning("训练时间剩余 2 分钟，即将自动结束");
		}
	}, [remaining, timerActive, toast.warning]);

	useEffect(() => {
		if (remaining === 0 && timerActive && !autoEndRef.current) {
			autoEndRef.current = true;
			onAutoEnd();
		}
	}, [remaining, timerActive, onAutoEnd]);

	const stopTimer = useCallback(() => {
		setTimerActive(false);
		if (timerRef.current) {
			clearInterval(timerRef.current);
			timerRef.current = null;
		}
	}, []);

	const resetTimer = useCallback(() => {
		warned5Ref.current = false;
		warned2Ref.current = false;
		autoEndRef.current = false;
		stopTimer();
	}, [stopTimer]);

	const formatTime = useCallback((sec: number | null): string => {
		if (sec == null || !Number.isFinite(sec) || sec < 0) return "--:--";
		if (sec > 59940) return "999:59";
		const m = Math.floor(sec / 60);
		const s = Math.floor(sec % 60);
		return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
	}, []);

	return {
		remaining,
		timerActive,
		stopTimer,
		resetTimer,
		formatTime,
		setRemaining,
		setTimerActive,
	};
}
