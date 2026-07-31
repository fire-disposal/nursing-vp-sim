import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useToast } from "@/components/Toast";

interface UseTrainingTimerOptions {
	/** ISO 时间戳：训练创建时刻（服务端 `start_time`，倒计时锚点）。 */
	startTime: string | null;
	/** 训练时长（分钟），与服务端 `time_limit` 同源。 */
	timeLimitMinutes: number | null;
	/** 训练进行中才计时。 */
	enabled: boolean;
	/** 本地到达 deadline 时触发一次。 */
	onAutoEnd: () => void;
}

/**
 * 墙钟训练倒计时。
 *
 * deadline = start_time + time_limit，用 Date.now() 追踪——不受浏览器后台
 * tab 节流影响；且与服务端放行规则（chat 守卫用同一 deadline）天然同源，
 * 前端显示 0 与后端拒发消息之间不再有偏差。
 */
export function useTrainingTimer({
	startTime,
	timeLimitMinutes,
	enabled,
	onAutoEnd,
}: UseTrainingTimerOptions) {
	const [now, setNow] = useState(() => Date.now());
	const autoEndRef = useRef(false);
	const warned5Ref = useRef(false);
	const warned2Ref = useRef(false);
	const toast = useToast();

	const deadlineMs = useMemo(() => {
		if (!startTime || !timeLimitMinutes) return null;
		const start = new Date(startTime).getTime();
		if (Number.isNaN(start)) return null;
		return start + timeLimitMinutes * 60_000;
	}, [startTime, timeLimitMinutes]);

	useEffect(() => {
		if (deadlineMs == null) return;
		const id = setInterval(() => {
			if (Date.now() >= deadlineMs) {
				setNow(deadlineMs); // 钳制在 deadline，停止空转
				clearInterval(id);
			} else {
				setNow(Date.now());
			}
		}, 1000);
		return () => clearInterval(id);
	}, [deadlineMs]);

	const remaining = useMemo(() => {
		if (deadlineMs == null || !enabled) return null;
		return Math.max(0, Math.ceil((deadlineMs - now) / 1000));
	}, [deadlineMs, now, enabled]);

	// 5/2 分钟提醒 — 区间触发，后台节流跳 tick 也不漏报。
	useEffect(() => {
		if (remaining == null) return;
		if (remaining <= 300 && remaining > 0 && !warned5Ref.current) {
			warned5Ref.current = true;
			toast.warning("训练时间剩余 5 分钟");
		}
		if (remaining <= 120 && remaining > 0 && !warned2Ref.current) {
			warned2Ref.current = true;
			toast.warning("训练时间剩余 2 分钟，即将自动结束");
		}
	}, [remaining, toast.warning]);

	useEffect(() => {
		if (remaining === 0 && enabled && !autoEndRef.current) {
			autoEndRef.current = true;
			onAutoEnd();
		}
	}, [remaining, enabled, onAutoEnd]);

	const formatTime = useCallback((sec: number | null): string => {
		if (sec == null || !Number.isFinite(sec) || sec < 0) return "--:--";
		if (sec > 59940) return "999:59";
		const m = Math.floor(sec / 60);
		const s = Math.floor(sec % 60);
		return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
	}, []);

	return { remaining, formatTime };
}
