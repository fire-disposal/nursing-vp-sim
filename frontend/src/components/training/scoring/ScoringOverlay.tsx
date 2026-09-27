import { Box, Button, Group, Loader, Progress, SimpleGrid, Text } from "@mantine/core";
import { IconBrain, IconLoader2, IconRotate } from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { MessageBus, ScorePhase } from "@/engine/types";

const phaseLabels: Record<string, string> = {
	loading: "正在加载对话记录...",
	scoring: "正在评分维度分析",
	feedback: "正在生成反馈建议",
	saving: "正在保存评分结果...",
	completed: "评分完成",
	failed: "评分失败",
	processing: "评分处理中...",
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
	getProgress,
	subscribeProgress,
	onRetry,
}: {
	bus: MessageBus;
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
	const navigate = useNavigate();

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
		const unsub = subscribeProgress(() => {
			const p = getProgressRef.current();
			setProgress(p);
			if (p.phase === "completed") { setClosing(true); setTimeout(() => setVisible(false), 800); }
		});
		return unsub;
	}, [visible, subscribeProgress]);

	if (!visible) return null;

	const phaseText = progress.phase ? phaseLabels[progress.phase] || progress.phase : "";
	const isActive = progress.phase !== "completed" && progress.phase !== "failed";
	const isFailed = progress.phase === "failed";
	// 后端没有给出可靠进度时不做百分比陈述（前端不编造数字）
	const isIndeterminate = isActive && progress.indeterminate === true;

	const handleRetry = async () => {
		if (!onRetry || retrying) return;
		setRetrying(true);
		try { await onRetry(); } catch { /* toast handled by caller */ }
		finally { setTimeout(() => setRetrying(false), 3000); }
	};

	const accentBg = isFailed ? "var(--mantine-color-red-light)" : "var(--mantine-primary-color-light)";
	const accentFg = isFailed ? "var(--mantine-color-red-light-color)" : "var(--mantine-primary-color-light-color)";

	return (
		<Box
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
			}}
		>
			<Box
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
						{isActive ? <IconLoader2 size={16} className="animate-spin" /> : <IconBrain size={16} />}
					</Box>
					<Box style={{ minWidth: 0 }}>
						<Text size="sm" fw={600} truncate>{isActive ? "正在评估训练表现" : isFailed ? "评估失败" : "评估完成"}</Text>
						<Text size="xs" c="dimmed">{phaseText}{isIndeterminate ? " · 进行中" : ` · ${progress.percentage}%`}</Text>
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
										{progress.score_thought ? <Text component="span" size="xs" style={{ whiteSpace: "pre-wrap", wordBreak: "break-all", color: "var(--mantine-color-text)", opacity: 0.7 }}>{progress.score_thought}</Text> : <Group gap={6} wrap="nowrap"><Loader size={10} type="dots" color="gray" /><Text component="span" size="xs" c="dimmed">等待评分维度分析...</Text></Group>}
									</Box>
								</Box>
								<Box px={8} py={6} style={{ borderRadius: 6, border: "1px solid var(--mantine-color-default-border)", background: "var(--mantine-color-default-hover)" }}>
									<Text size="xs" ff="monospace" c="brand" mb={4}>$ feedback_gen</Text>
									<Box
										ref={feedbackScrollRef}
										style={{ maxHeight: 128, overflowY: "auto", fontSize: 11, lineHeight: 1.6, fontFamily: "monospace", color: "var(--mantine-color-dimmed)" }}
									>
										{progress.feedback_thought ? <Text component="span" size="xs" style={{ whiteSpace: "pre-wrap", wordBreak: "break-all", color: "var(--mantine-color-text)", opacity: 0.7 }}>{progress.feedback_thought}</Text> : <Group gap={6} wrap="nowrap"><Loader size={10} type="dots" color="gray" /><Text component="span" size="xs" c="dimmed">等待反馈生成...</Text></Group>}
									</Box>
								</Box>
							</SimpleGrid>
						)}
					</Box>
				)}

				{/* Error */}
				{isFailed && progress.message && (
					<Box
						mb="md"
						px="sm"
						py={8}
						style={{ borderRadius: 6, border: "1px solid var(--mantine-color-red-outline)", background: "var(--mantine-color-red-light)" }}
					>
						<Text size="xs" c="var(--mantine-color-red-light-color)" style={{ whiteSpace: "pre-wrap" }}>{progress.message}</Text>
						{onRetry && (
							<Button
								variant="subtle"
								size="xs"
								color="blue"
								mt={8}
								onClick={handleRetry}
								disabled={retrying}
								leftSection={retrying ? <IconLoader2 size={12} className="animate-spin" /> : <IconRotate size={12} />}
							>
								重试评分
							</Button>
						)}
					</Box>
				)}

				{/* Footer */}
				{isActive && (
					<Group justify="space-between" gap={12} mt="md" wrap="nowrap">
						<Text size="11px" c="dimmed" lh={1.4}>
							评分完成后自动跳转结果页，<br />也可提前返回训练选择
						</Text>
						<Button
							variant="outline"
							size="xs"
							onClick={() => { setClosing(true); setTimeout(() => { setVisible(false); navigate(-1); }, 200); }}
							style={{ flexShrink: 0 }}
						>
							返回训练选择
						</Button>
					</Group>
				)}
			</Box>
		</Box>
	);
}
