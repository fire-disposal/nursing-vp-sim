import { IconArrowLeft, IconClipboardCheck, IconClock, IconEarOff, IconVolume2 } from "@tabler/icons-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ActionIcon, Box, Button, Group, Modal, Stack, Text } from "@mantine/core";

import { useShortViewport } from "@/hooks/useShortViewport";
import { useTrainingTimer } from "@/hooks/useTrainingTimer";
import { subscribeWSConnection } from "@/hooks/useTrainingWS";
import { useToast } from "@/components/Toast";
import { useTrainingStore } from "@/stores/trainingStore";

/** WS 实时连接状态点 — 绿=正常，黄（闪烁）=中断重连中。WS 承载查体/护理记录/评分推送。 */
function WSStatusDot() {
	const [connected, setConnected] = useState(false);
	useEffect(() => subscribeWSConnection(setConnected), []);
	const label = connected
		? "实时连接正常"
		: "实时连接中断，工具暂不可用，正在自动重连…";
	return (
		<Box
			component="span"
			role="status"
			aria-label={label}
			title={label}
			w={8}
			h={8}
			style={{
				flexShrink: 0,
				borderRadius: 999,
				background: connected ? "var(--mantine-color-green-6)" : "var(--mantine-color-yellow-6)",
			}}
		/>
	);
}

/**
 * Zero props — TrainingHeader reads precisely selected fields from trainingStore.
 * This avoids the prop-explosion problem that accumulated 13+ props.
 */
interface TrainingHeaderProps {
	toggleTts: () => void;
	endTraining: () => Promise<void>;
}

export function TrainingHeader({ toggleTts: onTtsToggle, endTraining: onEnd }: TrainingHeaderProps) {
	const patient = useTrainingStore(s => s.patient);
	const mode = useTrainingStore(s => s.recordDetail?.mode);
	const hideCaseInfo = useTrainingStore(s => s.recordDetail?.hide_case_info === true);
	const isHiddenCase = mode === "blind_box" || hideCaseInfo;
	const trainingEnded = useTrainingStore(s => s.trainingEnded);
	const studentMsgCount = useTrainingStore(s => s.messages.filter(m => m.role === "student").length);
	const ttsAutoPlay = useTrainingStore(s => s.ttsAutoPlay);
	const isShort = useShortViewport();
	const navigate = useNavigate();
	const [endConfirmOpen, setEndConfirmOpen] = useState(false);
	const [leaveDialogOpen, setLeaveDialogOpen] = useState(false);
	const endingRef = useRef(false);
	const toast = useToast();
	const initialRemaining = useTrainingStore((s) => s.recordDetail?.remaining_seconds);

	const {
		remaining,
		formatTime,
	} = useTrainingTimer({
		initialRemainingSeconds: initialRemaining ?? null,
		enabled: !trainingEnded,
		onTimeUp: () => {
			// 温和提示：时间到不强制交卷，训练结束由用户主动触发
			toast.info("训练时间已到，你可以继续对话或随时结束训练");
		},
	});

	const executeEnd = useCallback(async () => {
		if (endingRef.current) return;
		endingRef.current = true;
		setEndConfirmOpen(false);
		try {
			await onEnd();
		} catch {
			toast.apiError(null, "结束训练失败，请重试");
		} finally {
			endingRef.current = false;
		}
	}, [onEnd, toast]);

	const handleEndClick = useCallback(() => {
		setEndConfirmOpen(true);
	}, []);

	const headerStyle = {
		zIndex: 10,
		background: "var(--mantine-color-body)",
		paddingTop: "env(safe-area-inset-top, 0px)",
		boxShadow: "var(--mantine-shadow-xs)",
		height: isShort ? 36 : 44,
	};

	if (!patient) {
		return (
			<Box component="header" pos="absolute" top={0} left={0} right={0} px="xs" style={headerStyle}>
				<Group h="100%" gap={8}>
					<Text size="xs" c="dimmed">正在准备患者信息…</Text>
				</Group>
			</Box>
		);
	}

	const timerTone =
		remaining == null
			? { background: "var(--mantine-color-gray-0)", color: "var(--mantine-color-dimmed)", border: "1px solid var(--mantine-color-default-border)" }
			: remaining <= 120
				? { background: "var(--mantine-color-red-6)", color: "var(--mantine-color-white)", border: "1px solid transparent" }
				: remaining <= 300
					? { background: "var(--mantine-color-yellow-6)", color: "var(--mantine-color-dark)", border: "1px solid transparent" }
					: { background: "var(--mantine-color-body)", color: "var(--mantine-color-dimmed)", border: "1px solid var(--mantine-color-default-border)" };

	return (
		<>
			<Box component="header" pos="absolute" top={0} left={0} right={0} px="xs" style={headerStyle}>
				<Group gap={8} h="100%" wrap="nowrap">
					<ActionIcon
						variant="default"
						size="lg"
						onClick={() => setLeaveDialogOpen(true)}
						title="返回训练选择"
						aria-label="返回训练选择"
					>
						<IconArrowLeft size={16} />
					</ActionIcon>

					{isHiddenCase ? (
						<Group gap={8} wrap="nowrap" style={{ flex: 1, minWidth: 0 }}>
							<Box>
								<Text size="sm" fw={600} truncate lh={1.2}>
									{mode === "blind_box" ? "盲盒训练" : "隐藏病例练习"}
								</Text>
								<Text size="xs" c="dimmed" truncate lh={1.2}>
									{mode === "blind_box" ? "随机病例 · 自主练习" : "病例固定 · 结束后揭示"}
								</Text>
							</Box>
						</Group>
					) : (
						<Group gap={8} wrap="nowrap" style={{ flex: 1, minWidth: 0 }}>
							<Box style={{ minWidth: 0 }}>
								<Text size="sm" fw={600} truncate lh={1.2}>
									{patient.name}
								</Text>
								<Text size="xs" c="dimmed" truncate lh={1.2}>
									{patient.caseTitle || patient.chiefComplaint}
								</Text>
							</Box>
						</Group>
					)}

					<Group
						gap={6}
						px={8}
						py={4}
						wrap="nowrap"
						style={{
							borderRadius: 6,
							fontSize: 13,
							fontWeight: 700,
							fontVariantNumeric: "tabular-nums",
							flexShrink: 0,
							...timerTone,
						}}
					>
						<WSStatusDot />
						<IconClock size={12} style={{ flexShrink: 0 }} />
						<Text span fw={700} size="sm" style={{ color: "inherit" }}>{formatTime(remaining)}</Text>
					</Group>

					<ActionIcon
						variant={ttsAutoPlay ? "light" : "default"}
						size="lg"
						onClick={onTtsToggle}
						title={ttsAutoPlay ? "关闭朗读" : "开启朗读"}
					>
						{ttsAutoPlay ? <IconVolume2 size={16} /> : <IconEarOff size={16} />}
					</ActionIcon>
					<Button
						variant="light"
						color="red"
						size="sm"
						onClick={handleEndClick}
						title="完成训练并查看评分"
					>
						<IconClipboardCheck size={14} />
						完成训练
					</Button>
				</Group>
			</Box>
			<Modal opened={endConfirmOpen} onClose={() => setEndConfirmOpen(false)} title="结束训练" size={360} centered withinPortal>
				<Text size="sm" c="dimmed" mb="xl">
					已发送 {studentMsgCount} 条消息，确定要结束本次训练吗？结束后系统将自动生成评分。
				</Text>
				<Group justify="flex-end" gap={8}>
					<Button
						variant="outline"
						size="sm"
						onClick={() => setEndConfirmOpen(false)}
					>
						取消
					</Button>
					<Button variant="filled" size="sm" onClick={executeEnd}>
						确认结束
					</Button>
				</Group>
			</Modal>

			<Modal opened={leaveDialogOpen} onClose={() => setLeaveDialogOpen(false)} title="离开训练" size={300} centered withinPortal>
				<Text size="sm" c="dimmed" mb="xl">训练仍在进行中，进度已自动保存</Text>
				<Stack gap={8}>
					<Button onClick={() => { setLeaveDialogOpen(false); navigate(-1); }}>
						暂离，保留进度
					</Button>
					<Button variant="outline" onClick={() => setLeaveDialogOpen(false)}>
						继续训练
					</Button>
				</Stack>
			</Modal>

		</>
	);
}
