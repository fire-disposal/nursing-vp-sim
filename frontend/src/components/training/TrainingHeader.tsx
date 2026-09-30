import { IconArrowLeft, IconClipboardCheck, IconClock, IconEarOff, IconVolume2 } from "@tabler/icons-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ActionIcon, Badge, Box, Button, Group, Modal, Stack, Text } from "@mantine/core";

import { useIsMobile } from "@/hooks/useLayoutMode";
import { useShortViewport } from "@/hooks/useShortViewport";
import { useTrainingTimer } from "@/hooks/useTrainingTimer";
import { pauseTraining } from "@/api/training";
import { useToast } from "@/components/Toast";
import { CompletionChecklist } from "@/components/training/workspace/CompletionStatus";
import { ACTION_COMPLETE_SESSION, completionBlockers } from "@/engine/manifest";
import { usePatientData, useRecordMeta, useSessionManifest } from "@/engine/TrainingDataContext";
import { readTrainingOrigin, trainingOriginLabel } from "@/utils/training-nav";
import { useTrainingStore } from "@/stores/trainingStore";

/** 顶栏高度（px）：桌面 56，手机/矮视口 44。内容区退避与右侧面板起点都读这里，避免三处各写一个数。 */
export const TRAINING_HEADER_HEIGHT = { wide: 56, short: 44 } as const;

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
	const recordId = useTrainingStore(s => s.recordId);
	const bus = useTrainingStore(s => s.bus);
	const isShort = useShortViewport();
	const isMobile = useIsMobile();
	const headerHeight = isShort || isMobile ? TRAINING_HEADER_HEIGHT.short : TRAINING_HEADER_HEIGHT.wide;
	const navigate = useNavigate();
	// 出口落点由进入时写入的 `state.from` 决定（直链/刷新无来源 → 记录列表）；文案随之变化，
	// 不再写死「返回训练选择」——15 类入口里多数并非训练选择页。
	const location = useLocation();
	const from = readTrainingOrigin(location.state);
	const leaveLabel = trainingOriginLabel(from);
	const [endConfirmOpen, setEndConfirmOpen] = useState(false);
	const [leaveDialogOpen, setLeaveDialogOpen] = useState(false);
	const endingRef = useRef(false);
	const [leaving, setLeaving] = useState(false);
	/** 服务端语音不可用 → 浏览器内置语音兜底时的实际供应商名（null = 未降级） */
	const [ttsDegradedProvider, setTtsDegradedProvider] = useState<string | null>(null);
	const ttsDegradedRef = useRef<string | null>(null);
	const toast = useToast();
	const initialRemaining = remainingSeconds;
	const manifest = useSessionManifest();
	const completeAction = manifest?.actions.find((action) => action.id === ACTION_COMPLETE_SESSION);
	// 能否结束只由服务端 action.enabled 决定（前端不重算完成条件）
	const canComplete = completeAction?.enabled === true;
	// 交卷按钮的唯一文案来源：manifest 声明优先、回退"结束训练"。可见文案与 aria-label 共用，
	// 避免两处措辞漂移（2026-09-26 前该按钮在桌面端只显示图标、无 aria-label，见 UI-TRN-1）。
	const completeEndLabel = completeAction?.label ?? "结束训练";
	// 还缺几项才能交卷：数字只在未满足时出现，点按钮看逐条原因
	const blockerCount = completionBlockers(manifest).length;
	// 降级时按钮文案说明**当前实际用的是什么**，而不是只描述开/关（否则学生以为听到了服务端语音）
	const ttsToggleLabel = ttsDegradedProvider
		? `服务端语音暂不可用，已降级为「${ttsDegradedProvider}」朗读（点击${ttsAutoPlay ? "关闭" : "开启"}朗读）`
		: ttsAutoPlay
			? "关闭朗读"
			: "开启朗读";

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
			void executeEnd({ auto: true });
		},
	});

	const executeEnd = useCallback(async (options?: { auto?: boolean }) => {
		if (endingRef.current) return;
		endingRef.current = true;
		setEndConfirmOpen(false);
		try {
			await onEnd();
		} catch {
			// toast 由 TrainingEngine 给出（含具体失败原因）。到点自动交卷被拦下时，原因不能
			// 只留在会消失的 toast 里——把完成清单重新摆出来（此时学生已无法退回可训练态）。
			if (options?.auto) setEndConfirmOpen(true);
		} finally {
			endingRef.current = false;
		}
	}, [onEnd]);

	const handleEndClick = useCallback(() => {
		setEndConfirmOpen(true);
	}, []);

	// 语音降级信号：服务端 TTS 熔断/失败时 TTSManager 回落到浏览器内置语音，
	// 并发出 `tts:degraded` —— 此前该事件没有任何消费者，学生只会听到音色悄悄变了。
	// `tts:provider-status` 在每轮回复结束时上报实际使用的供应商：变回非降级供应商即视为恢复。
	useEffect(() => {
		if (!bus) return;
		const offDegraded = bus.on("tts:degraded", (payload?: { provider?: string }) => {
			const provider = payload?.provider ?? "浏览器内置语音";
			if (ttsDegradedRef.current === provider) return;
			ttsDegradedRef.current = provider;
			setTtsDegradedProvider(provider);
			toast.warning(`服务端语音暂不可用，已降级为「${provider}」朗读`);
		});
		const offStatus = bus.on("tts:provider-status", (payload?: { provider?: string }) => {
			if (!payload?.provider || payload.provider === ttsDegradedRef.current) return;
			ttsDegradedRef.current = null;
			setTtsDegradedProvider(null);
		});
		return () => {
			offDegraded();
			offStatus();
		};
	}, [bus, toast]);

	const executeLeave = useCallback(async () => {
		if (leaving) return;
		setLeaving(true);
		try {
			await onLeave();
			// 按钮承诺的是「暂停计时」：必须等服务器确认后再离开。旧实现只发一个不保证送达的
			// 请求就跳转，UI 于是宣称了一个从未发生（sendBeacon 无 Authorization → 401）的暂停。
			if (!isAssessment && recordId) {
				try {
					await pauseTraining(recordId);
				} catch {
					toast.error("未能确认服务器已暂停计时，已留在当前页面，请检查网络后重试");
					return;
				}
			}
			setLeaveDialogOpen(false);
			navigate(from ?? "/history");
		} catch {
			/* toast 由 TrainingEngine 给出（含具体失败原因），失败时留在当前页 */
		} finally {
			setLeaving(false);
		}
	}, [leaving, navigate, onLeave, isAssessment, recordId, toast, from]);

	const headerStyle = {
		zIndex: 10,
		background: "var(--mantine-color-body)",
		paddingTop: "env(safe-area-inset-top, 0px)",
		boxShadow: "var(--mantine-shadow-xs)",
		height: headerHeight,
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
			? { background: "var(--mantine-color-default-hover)", color: "var(--mantine-color-dimmed)", border: "1px solid var(--mantine-color-default-border)" }
			: remaining <= 120
				? { background: "var(--mantine-color-red-6)", color: "var(--mantine-color-white)", border: "1px solid transparent" }
				: remaining <= 300
					? { background: "var(--mantine-color-yellow-6)", color: "var(--mantine-color-dark)", border: "1px solid transparent" }
					: { background: "var(--mantine-color-body)", color: "var(--mantine-color-dimmed)", border: "1px solid var(--mantine-color-default-border)" };

	return (
		<>
			<Box component="header" pos="absolute" top={0} left={0} right={0} px="xs" style={headerStyle}>
				<Group gap={8} h="100%" wrap="nowrap" justify="space-between">
					<ActionIcon
						variant="default"
						size={isShort ? "md" : "lg"}
						onClick={() => setLeaveDialogOpen(true)}
						title={leaveLabel}
						aria-label={leaveLabel}
					>
						<IconArrowLeft size={isShort ? 14 : 16} />
					</ActionIcon>

					{isHiddenCase ? (
						<Group gap={8} wrap="nowrap" display={{ base: "none", sm: "flex" }} style={{ flex: 1, minWidth: 0 }}>
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
						<Group gap={8} wrap="nowrap" display={{ base: "none", sm: "flex" }} style={{ flex: 1, minWidth: 0 }}>
							<Box style={{ minWidth: 0 }}>
								{/* 患者姓名/年龄由患者列（桌面）与患者条（手机）承担，这里只说"这是哪一次训练" */}
								<Text size="sm" fw={600} truncate lh={1.2}>
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
						<IconClock size={12} style={{ flexShrink: 0 }} />
						<Text span fw={700} size="sm" style={{ color: "inherit" }}>
							{expired ? "已到期" : formatTime(remaining)}
						</Text>
					</Group>

					<ActionIcon
						variant={ttsDegradedProvider || ttsAutoPlay ? "light" : "default"}
						color={ttsDegradedProvider ? "yellow" : undefined}
						size={isShort ? "md" : "lg"}
						onClick={onTtsToggle}
						title={ttsToggleLabel}
						aria-label={ttsToggleLabel}
					>
						{ttsAutoPlay ? <IconVolume2 size={isShort ? 14 : 16} /> : <IconEarOff size={isShort ? 14 : 16} />}
					</ActionIcon>
					{ttsDegradedProvider && (
						<Text span size="xs" c="yellow.7" fw={700} title={ttsToggleLabel}>
							语音降级
						</Text>
					)}
					<Button
						// 两态都用 danger 色：这个按钮无论完成条件是否满足，都进入"结束训练"流程
						// （未满足时先展示还缺什么），属于终结性动作。曾试过阻塞态改 warning 橙，
						// 实测 orange-9 on orange-1 = 3.62:1 低于 AA，而 red-9 on red-1 = 5.13:1 达标，
						// 故保持红色；"条件未满足"由 aria-label 与主区阻塞提示承担，不靠颜色。
						variant="light"
						color="red"
						size={isShort ? "xs" : "sm"}
						px={isShort ? 8 : undefined}
						onClick={handleEndClick}
						title={canComplete ? "结束训练并查看评分" : "查看完成条件"}
						aria-label={
							canComplete
								? `${completeEndLabel}（查看评分）`
								: `${completeEndLabel}，完成条件尚未满足`
						}
					>
						<IconClipboardCheck size={14} />
						<Text component="span" fw={600}>
							{completeEndLabel}
						</Text>
						{!canComplete && blockerCount > 0 && (
							<Badge size="xs" variant="filled" color="orange" radius="xl" px={6}>
								{blockerCount}
							</Badge>
						)}
					</Button>
				</Group>
			</Box>
			<Modal opened={endConfirmOpen} onClose={() => setEndConfirmOpen(false)} title="结束训练" size={420} centered withinPortal>
				<Text size="sm" c="dimmed" mb="md">
					已发送 {studentMsgCount} 条消息。结束后系统将自动生成评分。
				</Text>
				<Box mb="md">
					<CompletionChecklist onNavigated={() => setEndConfirmOpen(false)} />
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
					<Button variant="filled" size="sm" onClick={() => void executeEnd()} disabled={!canComplete}>
						确认结束
					</Button>
				</Group>
			</Modal>

			<Modal opened={leaveDialogOpen} onClose={() => setLeaveDialogOpen(false)} title="离开训练" size={300} centered withinPortal>
				<Text size="sm" c="dimmed" mb="xl">
					{isAssessment
						? "独立考核采用连续计时，离开页面后倒计时仍会继续。"
						: "离开前会先请服务器暂停计时；若服务器未确认暂停，将留在当前页面并提示。"}
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
