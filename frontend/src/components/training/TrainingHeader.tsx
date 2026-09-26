import { IconArrowLeft, IconClipboardCheck, IconClock, IconEarOff, IconVolume2 } from "@tabler/icons-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ActionIcon, Box, Button, Group, Modal, Stack, Text } from "@mantine/core";

import { useShortViewport } from "@/hooks/useShortViewport";
import { useTrainingTimer } from "@/hooks/useTrainingTimer";
import { subscribeWSConnection } from "@/hooks/useTrainingWS";
import { useToast } from "@/components/Toast";
import { CompletionChecklist } from "@/components/training/workspace/CompletionStatus";
import { ACTION_COMPLETE_SESSION } from "@/engine/manifest";
import { usePatientData, useRecordMeta, useSessionManifest } from "@/engine/TrainingDataContext";
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

interface TrainingHeaderProps {
	toggleTts: () => void;
	endTraining: () => Promise<void>;
	leaveTraining: () => Promise<void>;
}

export function TrainingHeader({
	toggleTts: onTtsToggle,
	endTraining: onEnd,
	leaveTraining: onLeave,
}: TrainingHeaderProps) {
	const patient = usePatientData();
	const { mode, hideCaseInfo, remainingSeconds } = useRecordMeta();
	const isAssessment = mode === "assessment";
	const isHiddenCase = mode === "blind_box" || hideCaseInfo;
	const trainingEnded = useTrainingStore(s => s.trainingEnded);
	const studentMsgCount = useTrainingStore(s => s.messages.filter(m => m.role === "student").length);
	const ttsAutoPlay = useTrainingStore(s => s.ttsAutoPlay);
	const isShort = useShortViewport();
	const navigate = useNavigate();
	const [endConfirmOpen, setEndConfirmOpen] = useState(false);
	const [leaveDialogOpen, setLeaveDialogOpen] = useState(false);
	const endingRef = useRef(false);
	const [leaving, setLeaving] = useState(false);
	const toast = useToast();
	const initialRemaining = remainingSeconds;
	const manifest = useSessionManifest();
	const completeAction = manifest?.actions.find((action) => action.id === ACTION_COMPLETE_SESSION);
	// 能否结束只由服务端 action.enabled 决定（前端不重算完成条件）
	const canComplete = completeAction?.enabled === true;

	const {
		remaining,
		formatTime,
		expired,
	} = useTrainingTimer({
		initialRemainingSeconds: initialRemaining ?? null,
		enabled: !trainingEnded,
		onTimeUp: () => {
			// D5 硬截止：到点自动交卷（executeEnd 内部有 endingRef 防重入与失败提示）
			toast.info("训练时间已到，正在自动提交…");
			void executeEnd();
		},
	});

	const executeEnd = useCallback(async () => {
		if (endingRef.current) return;
		endingRef.current = true;
		setEndConfirmOpen(false);
		try {
			await onEnd();
		} catch {
			/* toast 由 TrainingEngine 给出（含具体失败原因） */
		} finally {
			endingRef.current = false;
		}
	}, [onEnd, toast]);

	const handleEndClick = useCallback(() => {
		setEndConfirmOpen(true);
	}, []);

	const executeLeave = useCallback(async () => {
		if (leaving) return;
		setLeaving(true);
		try {
			await onLeave();
			setLeaveDialogOpen(false);
			navigate(-1);
		} catch {
			/* toast 由 TrainingEngine 给出（含具体失败原因），失败时留在当前页 */
		} finally {
			setLeaving(false);
		}
	}, [leaving, navigate, onLeave]);

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
						size={isShort ? "md" : "lg"}
						onClick={() => setLeaveDialogOpen(true)}
						title="返回训练选择"
						aria-label="返回训练选择"
					>
						<IconArrowLeft size={isShort ? 14 : 16} />
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
						<Text span fw={700} size="sm" style={{ color: "inherit" }}>
							{expired ? "已到期" : formatTime(remaining)}
						</Text>
					</Group>

					<ActionIcon
						variant={ttsAutoPlay ? "light" : "default"}
						size={isShort ? "md" : "lg"}
						onClick={onTtsToggle}
						title={ttsAutoPlay ? "关闭朗读" : "开启朗读"}
						aria-label={ttsAutoPlay ? "关闭朗读" : "开启朗读"}
					>
						{ttsAutoPlay ? <IconVolume2 size={isShort ? 14 : 16} /> : <IconEarOff size={isShort ? 14 : 16} />}
					</ActionIcon>
					<Button
						variant="light"
						color="red"
						size={isShort ? "xs" : "sm"}
						px={isShort ? 8 : undefined}
						onClick={handleEndClick}
						title={canComplete ? "结束训练并查看评分" : "查看完成条件"}
					>
						<IconClipboardCheck size={14} />
						<Text component="span" hiddenFrom="xs" fw={600}>
							{completeAction?.label ?? "结束训练"}
						</Text>
					</Button>
				</Group>
			</Box>
			<Modal opened={endConfirmOpen} onClose={() => setEndConfirmOpen(false)} title="结束训练" size={420} centered withinPortal>
				<Text size="sm" c="dimmed" mb="md">
					已发送 {studentMsgCount} 条消息。结束后系统将自动生成评分。
				</Text>
				<Box mb="md">
					<CompletionChecklist />
				</Box>
				{!canComplete && (
					<Text size="xs" c="orange" mb="sm">
						以上完成条件尚未满足，请先处理后再结束训练。
					</Text>
				)}
				<Group justify="flex-end" gap={8}>
					<Button
						variant="outline"
						size="sm"
						onClick={() => setEndConfirmOpen(false)}
					>
						取消
					</Button>
					<Button variant="filled" size="sm" onClick={executeEnd} disabled={!canComplete}>
						确认结束
					</Button>
				</Group>
			</Modal>

			<Modal opened={leaveDialogOpen} onClose={() => setLeaveDialogOpen(false)} title="离开训练" size={300} centered withinPortal>
				<Text size="sm" c="dimmed" mb="xl">
					{isAssessment
						? "独立考核采用连续计时，离开页面后倒计时仍会继续。"
						: "训练进度已自动保存，暂离期间倒计时会暂停。"}
				</Text>
				<Stack gap={8}>
					<Button onClick={executeLeave} loading={leaving}>
						{isAssessment ? "离开，计时继续" : "暂离，暂停计时"}
					</Button>
					<Button variant="outline" onClick={() => setLeaveDialogOpen(false)}>
						继续训练
					</Button>
				</Stack>
			</Modal>

		</>
	);
}
