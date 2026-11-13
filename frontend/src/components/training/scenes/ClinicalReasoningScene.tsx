import { Box, Button, Center, Loader, Stack, Text, useMantineColorScheme } from "@mantine/core";
import { IconAlertTriangle, IconRefresh } from "@tabler/icons-react";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import type { ClinicalJudgmentState } from "@/api/clinical-reasoning";
import { endTraining } from "@/api/training";
import { queryKeys } from "@/api/query-keys";
import ErrorBoundary from "@/components/ErrorBoundary";
import { TrainingUnavailable } from "@/components/training/TrainingUnavailable";
import { useToast } from "@/components/Toast";
import { useTrainingTimer } from "@/hooks/useTrainingTimer";
import { useShortViewport } from "@/hooks/useShortViewport";
import { useTrainingData } from "@/engine/TrainingDataContext";
import { getApiErrorMessage } from "@/utils/error";
import { BedsideDock } from "@/components/training/clinical-reasoning/BedsideDock";
import { Composer } from "@/components/training/clinical-reasoning/Composer";
import { ControlBar } from "@/components/training/clinical-reasoning/ControlBar";
import { EvidenceChain, SceneBar } from "@/components/training/clinical-reasoning/EvidenceChain";
import { PatientStage } from "@/components/training/clinical-reasoning/PatientStage";
import {
	type ClinicalChatLine,
	mergeClinicalChatLines,
} from "@/components/training/clinical-reasoning/chat-lines";
import {
	useClinicalReasoning,
	type ClinicalActionError,
	type ClinicalSendError,
	type PendingAction,
} from "@/components/training/clinical-reasoning/useClinicalReasoning";
import { useEvidenceNexus } from "@/components/training/clinical-reasoning/useEvidenceNexus";
import {
	usePrefersReducedMotion,
	useWideWorkbench,
} from "@/components/training/clinical-reasoning/useWorkbenchLayout";
import "@/components/training/clinical-reasoning/clinical-reasoning.css";

/** 联结高亮的保留时长必须与 CSS keyframe（`cr-turn-link`，2.4s）一致。 */
const LINK_MS = 2400;

/**
 * 临床判断训练 V2 —— **床旁调查现场**（`workflow.id === "clinical_reasoning"`）。
 *
 * 视觉结构（自上而下，一条连续的现场，而不是三栏后台）：
 *
 * ```
 * 状态带：离开 · 关键线索刻度 · 行动/传达 · 计时 · 结束训练
 * ┌───────────── 主舞台：患者此刻 + 对话实录 ─────────────┬ 证据链 ┐
 * │  患者在说话（大字号、冷青脊线）                          │ 线索卡 │
 * │  我 · 护士（退半步、细描边）                             │ 待求证 │
 * ├───────────────── 输入带（对话 = 主操作）────────────────┴────────┤
 * └──────── 床旁操作坞：评估 · 行动 · 沟通（动作位）──────────────────┘
 * ```
 *
 * 关键约束（与产品意图一一对应）：
 * - **对话是主操作**：患者话语占据主舞台的视觉重心，不是三栏中间的一块空白。
 * - **证据是收集物**：`state.evidence` 串成一条链，实心脊线 = 已确认、虚线位 = 还有缺口；
 *   隐藏答案树不进前端，学生看不到"还差哪条"。
 * - **动作收进操作坞**：查体/行动/沟通三段横排，删除"右侧表单栏"的表单感。
 * - 新证据「浮现」保留：一次性入场 + 脊线亮起 + 「新」印记，并与产出它的那句话短暂联结；
 *   关闭动效后印记仍在（静态可读）。
 * - 结束训练复用 `endTraining` → 现有结果页自己轮询评分；本场景不做评分等待浮层。
 *
 * 与老工作区的关系：**零共享运行时**（不引 TrainingEngine / ActivityRail / 情绪 store），
 * 只共享既定的数据与 API 契约（`TrainingDataContext` + 记录/工具/聊天端点）。
 */
export default function ClinicalReasoningScene({ recordId }: { recordId: string }) {
	// 夜班是默认美术方向；学生若把 Mantine 切成浅色（白天值班），这里跟随 —— 两套变量
	// 结构相同，只翻明度，不出现"深色底 + 浅色卡片"的错配。
	const scheme = useMantineColorScheme().colorScheme === "light" ? "light" : "dark";
	return (
		<Box
			className="cr-workspace"
			data-scheme={scheme}
			style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}
		>
			<ErrorBoundary
				fallback={
					<TrainingUnavailable
						title="现场渲染失败"
						detail="临床判断现场出错了，请重试或返回。已确认的证据与对话都保存在服务器上。"
						onRetry={() => window.location.reload()}
					/>
				}
			>
				<ClinicalWorkbench recordId={recordId} />
			</ErrorBoundary>
		</Box>
	);
}

function ClinicalWorkbench({ recordId }: { recordId: string }) {
	const record = useTrainingData();
	const queryClient = useQueryClient();
	const navigate = useNavigate();
	const toast = useToast();

	const [ending, setEnding] = useState(false);
	const [endError, setEndError] = useState<string | null>(null);
	/** 交卷是不可撤销的：成功后锁死，失败时解锁允许重来。 */
	const finishingRef = useRef(false);

	/** 动作成功 / 消息送达后静默重读详情：消息 id、状态与评分前置都以服务端为准。 */
	const refreshRecord = useCallback(() => {
		void queryClient.invalidateQueries({ queryKey: queryKeys.training.detail(recordId) });
	}, [queryClient, recordId]);

	const clinical = useClinicalReasoning(recordId, refreshRecord);

	const recordMessages = record?.messages;
	const messageIds = useMemo(
		() => new Set((recordMessages ?? []).map((message) => message.id)),
		[recordMessages],
	);
	const { nexus, link } = useEvidenceNexus(clinical.state, messageIds);
	const reducedMotion = usePrefersReducedMotion();

	const { formatTime, expired } = useTrainingTimer({
		initialRemainingSeconds: record?.remaining_seconds ?? null,
		enabled: !ending,
		onTimeUp: () => {},
	});
	const clock = record?.remaining_seconds == null ? "--:--" : formatTime(record.remaining_seconds);

	const lines = useMemo(
		() => mergeClinicalChatLines(recordMessages ?? [], clinical.outbox),
		[clinical.outbox, recordMessages],
	);

	// 联结：新证据 → 产出它的那句话（滚动过去 + 等时长强调）。
	const anchorRef = useRef<HTMLDivElement | null>(null);
	const [linkedMessageId, setLinkedMessageId] = useState<number | null>(null);
	useLayoutEffect(() => {
		if (link.messageId === null) return;
		setLinkedMessageId(link.messageId);
		anchorRef.current?.scrollIntoView({
			block: "center",
			behavior: reducedMotion ? "auto" : "smooth",
		});
		const timer = window.setTimeout(() => setLinkedMessageId(null), LINK_MS);
		return () => window.clearTimeout(timer);
	}, [link.findingId, link.messageId, nexus.wave, reducedMotion]);

	/** 点证据 → 定位到产出它的那句对话（不依赖动效的键盘/触屏路径）。 */
	const focusMessage = useCallback((messageId: number) => {
		setLinkedMessageId(messageId);
		anchorRef.current?.scrollIntoView({ block: "center", behavior: "auto" });
		window.setTimeout(() => setLinkedMessageId(null), LINK_MS);
	}, []);

	const handleEnd = useCallback(async () => {
		if (finishingRef.current) return;
		finishingRef.current = true;
		setEnding(true);
		setEndError(null);
		try {
			await endTraining(recordId);
			void queryClient.invalidateQueries({ queryKey: queryKeys.training.all });
			toast.success("已交卷，正在生成评分");
			navigate(`/record/${recordId}`, { replace: true });
		} catch (err) {
			setEndError(getApiErrorMessage(err, "结束训练失败"));
			toast.apiError(err, "结束训练失败");
			finishingRef.current = false;
			setEnding(false);
		}
		// 成功路径不解除锁：页面正在跳转，再点也只会得到"训练已结束"。
	}, [navigate, queryClient, recordId, toast]);

	// 首次状态加载失败：现场没有可信状态 —— 全屏可重试失败态（自带出口）。
	if (clinical.state === null) {
		if (clinical.loading) {
			return (
				<Center mih="100dvh">
					<Stack align="center" gap="sm">
						<Loader size="sm" color="teal" />
						<Text size="sm" c="var(--ns-ink-dim)">
							正在接入床旁…
						</Text>
					</Stack>
				</Center>
			);
		}
		return (
			<TrainingUnavailable
				title={clinical.loadError ? "无法读取训练状态" : "训练状态不可用"}
				detail={clinical.loadError ?? "服务器没有返回本次训练的场景与目标，请重试。"}
				onRetry={() => void clinical.reload()}
			/>
		);
	}

	return (
		<Box style={{ display: "flex", flexDirection: "column", height: "100dvh", minHeight: 0 }}>
			<ControlBar
				state={clinical.state}
				recordId={recordId}
				clock={clock}
				expired={expired}
				hasPendingWork={clinical.sending || clinical.pendingAction !== null}
				ending={ending}
				endError={endError}
				onEnd={handleEnd}
			/>
			{clinical.refreshError && (
				<Box className="cr-notice" role="status">
					<IconAlertTriangle size={14} style={{ flexShrink: 0, marginTop: 2 }} aria-hidden />
					<Text size="xs" style={{ flex: 1, minWidth: 0 }}>
						状态刷新失败，下面是上一次确认的结果：{clinical.refreshError}
					</Text>
					<Button
						size="compact-xs"
						variant="subtle"
						color="gray"
						leftSection={<IconRefresh size={12} />}
						onClick={() => void clinical.reload()}
					>
						重试
					</Button>
				</Box>
			)}
			<Workbench
				state={clinical.state}
				freshIds={nexus.freshIds}
				linkedMessageId={linkedMessageId}
				lines={lines}
				caseName={record?.case_name ?? ""}
				sending={clinical.sending}
				sendError={clinical.sendError}
				locked={ending}
				pendingAction={clinical.pendingAction}
				actionError={clinical.actionError}
				clock={clock}
				expired={expired}
				onSend={clinical.send}
				onRetrySend={clinical.retrySend}
				onObserve={clinical.observe}
				onAct={clinical.act}
				onRetryAction={clinical.retryAction}
				onDismissActionError={clinical.dismissActionError}
				onReload={() => void clinical.reload()}
				onFocusMessage={focusMessage}
				linkAnchorRef={anchorRef}
			/>
		</Box>
	);
}

/**
 * 现场版式。
 *
 * - 桌面（≥`WIDTH.rail`）：主舞台（患者 + 实录 + 输入带）占据左侧 2/3，**证据链**是不宽的
 *   右侧栏（320）；操作坞横在两者之下 —— 这样对话永远是画面中心，证据是随手可扫的侧栏。
 * - 窄屏 / 手机：单列，顺序 = 主舞台（对话 + 输入）→ 操作坞 → 证据链。
 *   手机优先保证"对话与动作可达"：输入带与操作坞都在同一屏的滚动路径上，不藏进抽屉。
 */
function Workbench({
	state,
	freshIds,
	linkedMessageId,
	lines,
	caseName,
	sending,
	sendError,
	locked,
	pendingAction,
	actionError,
	clock,
	expired,
	onSend,
	onRetrySend,
	onObserve,
	onAct,
	onRetryAction,
	onDismissActionError,
	onReload,
	onFocusMessage,
	linkAnchorRef,
}: {
	state: ClinicalJudgmentState;
	freshIds: readonly string[];
	linkedMessageId: number | null;
	lines: ClinicalChatLine[];
	caseName: string;
	sending: boolean;
	sendError: ClinicalSendError | null;
	locked: boolean;
	pendingAction: PendingAction | null;
	actionError: ClinicalActionError | null;
	clock: string;
	expired: boolean;
	onSend: (content: string) => void;
	onRetrySend: () => void;
	onObserve: (findingId: string) => void;
	onAct: (objectiveId: string) => void;
	onRetryAction: () => void;
	onDismissActionError: () => void;
	onReload: () => void;
	onFocusMessage: (messageId: number) => void;
	linkAnchorRef: React.RefObject<HTMLDivElement | null>;
}) {
	const wide = useWideWorkbench();
	const shortViewport = useShortViewport();

	const stage = (
		<Box style={{ display: "flex", flexDirection: "column", minHeight: 0, height: "100%" }}>
			<PatientStage
				lines={lines}
				caseName={caseName}
				sending={sending}
				linkedMessageId={linkedMessageId}
				linkAnchorRef={linkAnchorRef}
				onFocusMessage={onFocusMessage}
				clock={clock}
				expired={expired}
			/>
			<Composer
				sending={sending}
				sendError={sendError}
				locked={locked}
				onSend={onSend}
				onRetrySend={onRetrySend}
			/>
		</Box>
	);

	const chain = (
		<Stack gap={14}>
			<SceneBar
				title={state.scenario.title}
				setting={state.scenario.setting}
				summary={state.scenario.summary}
				learnerBrief={state.scenario.learner_brief}
			/>
			<hr className="cr-hair" />
			<EvidenceChain
				state={state}
				freshIds={freshIds}
				linkedMessageId={linkedMessageId}
				onFocusMessage={onFocusMessage}
			/>
		</Stack>
	);

	const dock = (
		<BedsideDock
			state={state}
			pending={pendingAction}
			error={actionError}
			disabled={sending}
			busy={pendingAction !== null}
			onObserve={onObserve}
			onAct={onAct}
			onRetry={onRetryAction}
			onDismissError={onDismissActionError}
			onReload={onReload}
		/>
	);

	if (!wide || shortViewport) {
		// 手机/窄屏：**舞台先出现**（画面 + 对话框 + 输入），操作坞紧随其后（拇指可达），
		// 证据链放在最后按需滚动 —— 绝不把主舞台挤成一条缝。
		return (
			<Stack gap={0}>
				<Box
					style={{
						height: shortViewport ? "min(72dvh, 460px)" : "min(68dvh, 560px)",
						minHeight: 320,
						borderBottom: "1px solid var(--ns-line)",
					}}
				>
					{stage}
				</Box>
				{dock}
				<Box px="md" py="md" style={{ borderTop: "1px solid var(--ns-line)" }}>
					{chain}
				</Box>
			</Stack>
		);
	}

	return (
		<Box style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
			{/* 主舞台吃掉剩余高度；证据链在右侧独立滚动；操作坞固定在底部一条，
			    三者彼此不重叠 —— 画面永远不会被面板压住。 */}
			<Box style={{ flex: 1, display: "flex", minHeight: 0 }}>
				<Box style={{ flex: 1, minWidth: 0, minHeight: 0, position: "relative" }}>{stage}</Box>
				<Box
					className="cr-scroll"
					w={326}
					style={{
						flexShrink: 0,
						borderLeft: "1px solid var(--ns-line)",
						background: "var(--ns-void)",
					}}
				>
					<Box p="md">{chain}</Box>
				</Box>
			</Box>
			{dock}
		</Box>
	);
}
