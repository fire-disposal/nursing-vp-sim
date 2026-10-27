import { Box, Button, Group, Loader, Progress, SimpleGrid, Text } from "@mantine/core";
import { IconAlertTriangle, IconBrain, IconFileText, IconLoader2, IconRotate } from "@tabler/icons-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { MessageBus, ScorePhase } from "@/engine/types";

const phaseLabels: Record<string, string> = {
	loading: "正在加载对话记录…",
	scoring: "正在评分维度分析",
	feedback: "正在生成反馈建议",
	saving: "正在保存评分结果…",
	completed: "评分完成",
	failed: "评分失败",
	processing: "评分处理中…",
};

/** 本地进度视图（与 Mantine 的 `Progress` 组件同名会遮蔽，故显式区分） */
interface ScoringProgressView {
	phase: ScorePhase;
	percentage: number;
	message: string;
	/** 后端未给出可靠进度 = 不定态（不显示百分比） */
	indeterminate?: boolean;
	thought?: string;
	score_thought?: string;
	feedback_thought?: string;
}

export function ScoringOverlay({
	bus,
	recordId,
	getProgress,
	subscribeProgress,
	onRetry,
}: {
	bus: MessageBus;
	/** 提前退出的落点与自动跳转一致（训练记录详情）——两条出口必须同目的地。 */
	recordId: string;
	getProgress: () => ScoringProgressView;
	subscribeProgress: (fn: () => void) => () => void;
	onRetry?: () => Promise<void>;
}) {
	const [visible, setVisible] = useState(false);
	const [closing, setClosing] = useState(false);
	const [retrying, setRetrying] = useState(false);
	const [showThought, setShowThought] = useState(true);
	const [progress, setProgress] = useState<ScoringProgressView>({ phase: null, percentage: 0, message: "" });

	const scoreScrollRef = useRef<HTMLDivElement>(null);
	const feedbackScrollRef = useRef<HTMLDivElement>(null);
	const dialogRef = useRef<HTMLDivElement>(null);
	const navigate = useNavigate();

	// 遮罩打开时把焦点搬进弹层：否则键盘/读屏用户还在被遮挡的对话区里 Tab。
	useEffect(() => {
		if (visible) dialogRef.current?.focus();
	}, [visible]);

	useEffect(() => {
		if (scoreScrollRef.current) scoreScrollRef.current.scrollTop = scoreScrollRef.current.scrollHeight;
		if (feedbackScrollRef.current) feedbackScrollRef.current.scrollTop = feedbackScrollRef.current.scrollHeight;
	}, [progress.score_thought, progress.feedback_thought]);

	useEffect(() => {
		const unsub = bus.on("training:ended", () => { setVisible(true); setClosing(false); });
		return unsub;
	}, [bus]);

	const getProgressRef = useRef(getProgress);
	getProgressRef.current = getProgress;

	useEffect(() => {
		if (!visible) return;
		setProgress(getProgressRef.current());
		return subscribeProgress(() => setProgress(getProgressRef.current()));
	}, [visible, subscribeProgress]);

	// 完成即收起。按状态判断而不是写在订阅回调里：`training:ended` 到达时评分可能已经结束，
	// 此时初始快照就是 completed，订阅不会再回调，遮罩会一直挡在记录页前面。
	useEffect(() => {
		if (!visible || progress.phase !== "completed") return;
		setClosing(true);
		const timer = setTimeout(() => setVisible(false), 800);
		return () => clearTimeout(timer);
	}, [visible, progress.phase]);

	// 评分失败时记录已经落库，用户不该被困在遮罩里——失败是唯一允许关闭（或抽身去看记录）的态。
	const dismiss = useCallback(() => {
		setClosing(true);
		setTimeout(() => setVisible(false), 200);
	}, []);

	useEffect(() => {
		if (!visible || progress.phase !== "failed") return;
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key !== "Escape") return;
			event.stopPropagation();
			dismiss();
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [visible, progress.phase, dismiss]);

	if (!visible) return null;

	const phaseText = progress.phase ? phaseLabels[progress.phase] || progress.phase : "";
	const isActive = progress.phase !== "completed" && progress.phase !== "failed";
	const isFailed = progress.phase === "failed";
	// 后端没有给出可靠进度时不做百分比陈述（前端不编造数字）
	const isIndeterminate = isActive && progress.indeterminate === true;
	// 失败/未开始都不报百分比：0% 会被读成「一点没做」，而实际是没拿到进度
	const progressCaption = !progress.phase
		? "正在准备评分…"
		: isFailed
			? phaseText
			: isIndeterminate
				? `${phaseText} · 进行中`
				: `${phaseText} · ${progress.percentage}%`;

	const handleRetry = async () => {
		if (!onRetry || retrying) return;
		setRetrying(true);
		try { await onRetry(); } catch { /* toast handled by caller */ }
		finally { setTimeout(() => setRetrying(false), 3000); }
	};

	// 两条出口同目的地：评分成不成功都不影响训练记录已经落库。
	const goToRecord = () => {
		setClosing(true);
		setTimeout(() => {
			setVisible(false);
			navigate(`/record/${recordId}`, { replace: true });
		}, 200);
	};

	const accentBg = isFailed ? "var(--mantine-color-red-light)" : "var(--mantine-primary-color-light)";
	const accentFg = isFailed ? "var(--mantine-color-red-light-color)" : "var(--mantine-primary-color-light-color)";

	return (
		<Box
			ref={dialogRef}
			// 遮罩本身是弹层：标成 dialog 才能让读屏软件报出「哪一步失败了、有几个按钮」，
			// 否则整块只是视觉上的浮层，键盘/读屏用户在底下继续 Tab。
			role="dialog"
			aria-modal="true"
			aria-label={isFailed ? "评分失败" : isActive ? "正在评估训练表现" : "评分完成"}
			tabIndex={-1}
			style={{
				position: "fixed",
				inset: 0,
				zIndex: 40,
				display: "flex",
				alignItems: "center",
				justifyContent: "center",
				background: "rgba(0, 0, 0, 0.5)",
				opacity: closing ? 0 : 1,
				transition: "opacity 300ms",
				// 收起动画期间不再吃点击，否则用户会点到已经看不见的遮罩
				pointerEvents: closing ? "none" : undefined,
				outline: "none",
			}}
		>
			<Box
				aria-hidden={closing || undefined}
				style={{
					width: "100%",
					maxWidth: 384,
					margin: "0 16px",
					borderRadius: 12,
					border: "1px solid var(--mantine-color-default-border)",
					background: "var(--mantine-color-body)",
					padding: 20,
					boxShadow: "var(--mantine-shadow-lg)",
				}}
			>
				{/* Header */}
				<Group gap={12} mb="md" wrap="nowrap">
					<Box
						w={36}
						h={36}
						style={{
							borderRadius: 999,
							display: "flex",
							alignItems: "center",
							justifyContent: "center",
							flexShrink: 0,
							background: accentBg,
							color: accentFg,
						}}
					>
						{isActive ? <IconLoader2 size={16} className="animate-spin" /> : isFailed ? <IconAlertTriangle size={16} /> : <IconBrain size={16} />}
					</Box>
					<Box style={{ minWidth: 0 }}>
						<Text size="sm" fw={600} truncate>{isActive ? "正在评估训练表现" : isFailed ? "评估失败" : "评估完成"}</Text>
						<Text size="xs" c="dimmed" truncate aria-live="polite">{progressCaption}</Text>
					</Box>
				</Group>

				{/* Progress bar */}
				<Box h={6} w="100%" mb="md" style={{ borderRadius: 999, background: "var(--mantine-color-default-hover)", overflow: "hidden" }}>
					{isIndeterminate ? (
						<Progress.Root size={6} aria-label="评分进行中，进度未知">
							<Progress.Section value={100} animated striped color="brand" />
						</Progress.Root>
					) : (
						<Box
							h="100%"
							style={{
								width: `${Math.max(4, progress.percentage)}%`,
								borderRadius: 999,
								transition: "all 500ms ease-out",
								background: isFailed ? "var(--mantine-color-red-6)" : "var(--mantine-primary-color-filled)",
							}}
						/>
					)}
				</Box>

				{/* AI thought — expanded by default for entertainment while waiting */}
				{isActive && (progress.score_thought || progress.feedback_thought) && (
					<Box mb="md">
						<Box
							component="button"
							type="button"
							onClick={() => setShowThought((v) => !v)}
							style={{ fontSize: 11, color: "var(--mantine-color-dimmed)", background: "transparent", border: "none", cursor: "pointer" }}
						>
							{showThought ? "▲ 收起" : "▼ 展开"} AI 实时分析
						</Box>
						{showThought && (
							<SimpleGrid cols={2} spacing={8} mt={4}>
								<Box px={8} py={6} style={{ borderRadius: 6, border: "1px solid var(--mantine-color-default-border)", background: "var(--mantine-color-default-hover)" }}>
									<Text size="xs" ff="monospace" c="brand" mb={4}>$ scoring_dims</Text>
									<Box
										ref={scoreScrollRef}
										style={{ maxHeight: 128, overflowY: "auto", fontSize: 11, lineHeight: 1.6, fontFamily: "monospace", color: "var(--mantine-color-dimmed)" }}
									>
										{progress.score_thought ? <Text component="span" size="xs" style={{ whiteSpace: "pre-wrap", wordBreak: "break-all", color: "var(--mantine-color-text)", opacity: 0.7 }}>{progress.score_thought}</Text> : <Group gap={6} wrap="nowrap"><Loader size={10} type="dots" color="gray" /><Text component="span" size="xs" c="dimmed">等待评分维度分析…</Text></Group>}
									</Box>
								</Box>
								<Box px={8} py={6} style={{ borderRadius: 6, border: "1px solid var(--mantine-color-default-border)", background: "var(--mantine-color-default-hover)" }}>
									<Text size="xs" ff="monospace" c="brand" mb={4}>$ feedback_gen</Text>
									<Box
										ref={feedbackScrollRef}
										style={{ maxHeight: 128, overflowY: "auto", fontSize: 11, lineHeight: 1.6, fontFamily: "monospace", color: "var(--mantine-color-dimmed)" }}
									>
										{progress.feedback_thought ? <Text component="span" size="xs" style={{ whiteSpace: "pre-wrap", wordBreak: "break-all", color: "var(--mantine-color-text)", opacity: 0.7 }}>{progress.feedback_thought}</Text> : <Group gap={6} wrap="nowrap"><Loader size={10} type="dots" color="gray" /><Text component="span" size="xs" c="dimmed">等待反馈生成…</Text></Group>}
									</Box>
								</Box>
							</SimpleGrid>
						)}
					</Box>
				)}

				{/* Error */}
				{isFailed && (
					<Box
						mb="md"
						px="sm"
						py={8}
						style={{ borderRadius: 6, border: "1px solid var(--mantine-color-red-outline)", background: "var(--mantine-color-red-light)" }}
					>
						<Text size="xs" c="var(--mantine-color-red-light-color)" style={{ whiteSpace: "pre-wrap" }}>
							{progress.message || "评分没有完成，本次对话与训练记录已经保存。"}
						</Text>
						<Text size="xs" c="var(--mantine-color-red-light-color)" mt={4} opacity={0.85}>
							重试只会重新评分，不会影响已保存的对话记录。
						</Text>
						{onRetry && (
							<Button
								variant="light"
								size="xs"
								mt={8}
								onClick={handleRetry}
								disabled={retrying}
								leftSection={retrying ? <IconLoader2 size={12} className="animate-spin" /> : <IconRotate size={12} />}
							>
								{retrying ? "正在重新提交…" : "重试评分"}
							</Button>
						)}
					</Box>
				)}

				{/* Footer */}
				{isActive && (
					<Group justify="space-between" gap={12} mt="md" wrap="nowrap">
						<Text size="sm" c="dimmed" lh={1.4}>
							评分完成后自动跳转训练记录，<br />也可提前查看
						</Text>
						<Button variant="outline" size="xs" onClick={goToRecord} style={{ flexShrink: 0 }}>
							查看训练记录
						</Button>
					</Group>
				)}

				{/* 失败态的出口：不再只有一条「重试评分」把用户钉在这里（Esc 等价于「关闭」） */}
				{isFailed && (
					<Group justify="space-between" gap={8} mt="md" wrap="wrap">
						<Button variant="default" size="xs" onClick={dismiss}>
							关闭
						</Button>
						<Button
							variant="filled"
							size="xs"
							leftSection={<IconFileText size={14} />}
							onClick={goToRecord}
						>
							查看训练记录
						</Button>
					</Group>
				)}
			</Box>
		</Box>
	);
}
