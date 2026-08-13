import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { triggerInitiative } from "@/api/training";
import type { EmotionState } from "@/stores/trainingStore";
import {
	EMOTION_LABELS,
	useTrainingStore,
} from "@/stores/trainingStore";
import type { MessageBus } from "@/engine/types";
import { Box, Group, Text } from "@mantine/core";

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

/** 情绪标签 + 状态点的 Mantine 色名映射（原 shadcn 语义色 → Mantine 内置色）。 */
const EMOTION_COLOR: Record<EmotionState, string> = {
	withdrawn: "red",
	defensive: "orange",
	anxious: "violet",
	neutral: "dimmed",
	relaxed: "blue",
	open: "green",
};

const EMOTION_DOT: Record<EmotionState, string> = {
	withdrawn: "var(--mantine-color-red-6)",
	defensive: "var(--mantine-color-orange-6)",
	anxious: "var(--mantine-color-violet-6)",
	neutral: "var(--mantine-color-gray-6)",
	relaxed: "var(--mantine-color-blue-6)",
	open: "var(--mantine-color-green-6)",
};

export function EmotionIndicator({ bus, capabilities, recordId, compact, trailing }: EmotionIndicatorProps) {
	const emotion = useTrainingStore((s) => s.emotion);
	const trust = useTrainingStore((s) => s.trust);
	const anxiety = useTrainingStore((s) => s.anxiety);
	const irritation = useTrainingStore((s) => s.irritation);
	const cooperation = useTrainingStore((s) => s.cooperation);
	const emotion4D = useTrainingStore((s) => s.emotion4D);
	const [pulse, setPulse] = useState(false);
	const [emojiPop, setEmojiPop] = useState(false);
	const prevEmotionRef = useRef(emotion);
	const prevEmotion4DRef = useRef(emotion4D);
	const pulseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const popTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	// ── Initiative state ──
	const [initPercent, setInitPercent] = useState(0);
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
			// 后端是唯一决策者：任何响应（触发/拒绝/上限）都停表，直到下一轮 initiative:state 重新武装。
			// 防洪水：同窗口内绝不重试，即使 triggered=false。
			maxReachedRef.current = true;
			stopTicker();
			setInitPercent(0);
		} catch {
			// 网络错误：保持可重试（下一 tick 再试），但不超过 ticker 的自然频率
		} finally {
			pollingRef.current = false;
		}
	}, [recordId, bus, stopTicker]);

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
			() => {
			setPulse(true);
			clearTimeout(pulseTimerRef.current ?? undefined);
			pulseTimerRef.current = setTimeout(() => setPulse(false), 1200);
			},
		);
		return unsub;
	}, [bus]);
	useEffect(() => {
		if (emotion !== prevEmotionRef.current || emotion4D !== prevEmotion4DRef.current) {
			prevEmotionRef.current = emotion;
			prevEmotion4DRef.current = emotion4D;
			setEmojiPop(true);
			if (popTimerRef.current) clearTimeout(popTimerRef.current);
			popTimerRef.current = setTimeout(() => setEmojiPop(false), 400);
		}
	}, [emotion, emotion4D]);

	if (!capabilities.emotion) return null;
	const label = EMOTION_LABELS[emotion];
	const trustPct = Math.max(0, Math.min(100, trust));

	if (compact) {
		return (
			<Box
				style={{
					flexShrink: 0,
					borderBottom: "1px solid var(--mantine-color-default-border)",
					padding: "6px 8px",
					transition: "background-color 300ms",
					background: pulse ? "var(--mantine-primary-color-light)" : undefined,
				}}
			>
				<Group gap={6}>
					<Text
						size="sm"
						style={{
							lineHeight: 1,
							transition: "transform 300ms",
							transform: emojiPop ? "scale(1.25)" : undefined,
						}}
					>
						{EMOTION_ICONS[emotion]}
					</Text>
					<Text size="11px" c="dimmed" truncate>{label}</Text>
					{/* Trust micro-bar */}
					<Box w={40} h={4} style={{ borderRadius: 999, background: "var(--mantine-color-gray-2)", overflow: "hidden", flexShrink: 0 }}>
						<Box
							h="100%"
							style={{
								width: `${trustPct}%`,
								borderRadius: 999,
								transition: "all 700ms",
								background:
									trustPct >= 60
										? "var(--mantine-color-green-6)"
										: trustPct >= 40
											? "var(--mantine-color-yellow-6)"
											: "var(--mantine-color-red-6)",
							}}
						/>
					</Box>
					<Group gap={8} style={{ marginLeft: "auto" }}>
						{showInitiative && initPercent > 0 && (
							<Box w={48} h={4} style={{ borderRadius: 999, background: "var(--mantine-color-gray-2)", overflow: "hidden", flexShrink: 0 }}>
								<Box
									h="100%"
									style={{
										width: `${Math.min(100, initPercent)}%`,
										borderRadius: 999,
										transition: "all 1000ms",
										background:
											initPercent > 80
												? "var(--mantine-color-red-6)"
												: initPercent > 50
													? "var(--mantine-color-yellow-6)"
													: "var(--mantine-color-green-6)",
									}}
								/>
							</Box>
						)}
						{trailing}
					</Group>
				</Group>
			</Box>
		);
	}

	return (
		<Box
			style={{
				overflow: "hidden",
				transition: "all 300ms",
				flexShrink: 0,
				background: pulse ? "var(--mantine-primary-color-light)" : undefined,
			}}
		>
			<Group
				gap="sm"
				px="md"
				py={8}
				wrap="nowrap"
				style={{ borderBottom: "1px solid var(--mantine-color-default-border)" }}
			>
				{/* Emoji + label */}
				<Group gap={6} wrap="nowrap" style={{ flexShrink: 0 }}>
					<Text
						size="sm"
						style={{
							transition: "transform 300ms",
							transform: emojiPop ? "scale(1.25)" : undefined,
						}}
					>
						{EMOTION_ICONS[emotion]}
					</Text>
					<Text size="xs" fw={600} c={EMOTION_COLOR[emotion]}>
						{label}
					</Text>
					<Box w={8} h={8} style={{ borderRadius: 999, background: EMOTION_DOT[emotion] }} />
				</Group>

				{/* 4D bars: trust, anxiety, irritation, cooperation */}
				<Group gap={2} wrap="nowrap" style={{ flex: 1, minWidth: 0 }}>
					{[trust, anxiety, irritation, cooperation].map((v, i) => {
						const color = ["var(--mantine-color-green-6)", "var(--mantine-color-violet-5)", "var(--mantine-color-orange-5)", "var(--mantine-color-blue-5)"][i];
						const titles = ["信任", "焦虑", "烦躁", "配合"];
						return (
							<Box key={titles[i]} style={{ flex: 1, height: 6, borderRadius: 999, background: "var(--mantine-color-gray-2)", overflow: "hidden" }}>
								<Box
									h="100%"
									title={`${titles[i]}: ${v}`}
									style={{ width: `${v}%`, borderRadius: 999, transition: "all 700ms ease-out", background: color }}
								/>
							</Box>
						);
					})}
				</Group>
				{/* Initiative timer */}
				{showInitiative && initPercent > 0 && (
					<Group gap={6} wrap="nowrap" style={{ flexShrink: 0, maxWidth: 120 }}>
						<Text size="10px" c="dimmed" style={{ flexShrink: 0 }} visibleFrom="sm">追问</Text>
						<Box style={{ flex: 1, height: 6, borderRadius: 999, background: "var(--mantine-color-gray-2)", overflow: "hidden", minWidth: 40 }}>
							<Box
								h="100%"
								style={{
									width: `${Math.min(100, initPercent)}%`,
									borderRadius: 999,
									transition: "all 1000ms ease-linear",
									background:
										initPercent > 80
											? "var(--mantine-color-red-6)"
											: initPercent > 50
												? "var(--mantine-color-yellow-6)"
												: "var(--mantine-color-green-6)",
								}}
							/>
						</Box>
					</Group>
				)}
				{trailing}
			</Group>
		</Box>
	);
}
