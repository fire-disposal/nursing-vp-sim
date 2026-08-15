import { useCallback, useEffect, useRef, useState } from "react";
import { useToast } from "@/components/Toast";

interface UseTrainingTimerOptions {
	/** 服务端剩余秒数（detail.remaining_seconds，含暂停偏移）——倒计时权威起点。 */
	initialRemainingSeconds: number | null;
	/** 训练进行中才计时。 */
	enabled: boolean;
	/** 本地剩余归零时触发一次（温和提示，不强制交卷）。 */
	onTimeUp: () => void;
}

/**
 * 训练倒计时（体验模式）。
 *
 * 以服务端 remaining_seconds 为起点本地递减——离开训练页期间服务端累计暂停
 * （pause/resume 端点），重新进入时 detail 返回新的剩余值，倒计时自动续期。
 * 到点仅触发温和提示，不强制交卷；训练结束由用户主动触发。
 */
export function useTrainingTimer({
	initialRemainingSeconds,
	enabled,
	onTimeUp,
}: UseTrainingTimerOptions) {
	const [remaining, setRemaining] = useState<number | null>(initialRemainingSeconds);
	const timeUpRef = useRef(false);
	const warned5Ref = useRef(false);
	const warned2Ref = useRef(false);
	const toast = useToast();

	// 服务端值变化（重新进入/恢复）时重置本地递减
	useEffect(() => {
		setRemaining(initialRemainingSeconds);
		timeUpRef.current = false;
		warned5Ref.current = false;
		warned2Ref.current = false;
	}, [initialRemainingSeconds]);

	useEffect(() => {
		if (remaining == null || !enabled) return;
		if (remaining <= 0) return;
		const id = setInterval(() => {
			setRemaining((r) => (r == null ? r : Math.max(0, r - 1)));
		}, 1000);
		return () => clearInterval(id);
	}, [remaining != null, enabled]);

	// 5/2 分钟提醒 — 区间触发。
	useEffect(() => {
		if (remaining == null) return;
		if (remaining <= 300 && remaining > 0 && !warned5Ref.current) {
			warned5Ref.current = true;
			toast.warning("训练时间剩余 5 分钟");
		}
		if (remaining <= 120 && remaining > 0 && !warned2Ref.current) {
			warned2Ref.current = true;
			toast.warning("训练时间剩余 2 分钟");
		}
	}, [remaining, toast.warning]);

	useEffect(() => {
		if (remaining === 0 && enabled && !timeUpRef.current) {
			timeUpRef.current = true;
			onTimeUp();
		}
	}, [remaining, enabled, onTimeUp]);

	const formatTime = useCallback((sec: number | null): string => {
		if (sec == null || !Number.isFinite(sec) || sec < 0) return "--:--";
		if (sec > 59940) return "999:59";
		const m = Math.floor(sec / 60);
		const s = Math.floor(sec % 60);
		return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
	}, []);

	return {
		remaining: enabled ? remaining : null,
		/** 已到期（剩余 0 且训练进行中）——供外部触发自动结束。 */
		expired: enabled && remaining === 0,
		formatTime,
	};
}
