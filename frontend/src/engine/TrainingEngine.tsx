import type { ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Center, Flex, Stack, Text } from "@mantine/core";
import { queryKeys } from "@/api/query-keys";
import ErrorBoundary from "@/components/ErrorBoundary";
import { useToast } from "@/components/Toast";
import { LoadingSkeleton } from "@/components/ui";
import { ChatArea } from "@/components/training/ChatArea";
import PatientStage from "@/components/training/PatientStage";
import { ScoreCard, ScoringOverlay } from "@/components/training/scoring";
import { TrainingHeader } from "@/components/training/TrainingHeader";
import { getPatientAvatar } from "@/utils/avatar";
import { useShortViewport } from "@/hooks/useShortViewport";
import { useIsMobile } from "@/hooks/useLayoutMode";
import {
	useToolBridge,
	waitForPendingToolCommands,
} from "@/hooks/useToolBridge";
import { createMessageBus } from "./MessageBus";
import {
	useTrainingStore,
	getTrainingState,
} from "@/stores/trainingStore";
import {
	usePatientData,
	useTrainingType,
	useRecordCapabilities,
	useInitialMessages,
	useTimeLimit,
	useEmotionSeed,
	useSceneSeed,
	useRecordStatus,
	useRecordAsDetail,
} from "./TrainingDataContext";
import { ScoreManager } from "./ScoreManager";
import { StreamManager } from "./StreamManager";
import { TTSManager } from "./tts/TTSManager";
import { EMOTION_LABELS, type Emotion4DLabel, type EmotionState } from "@/stores/trainingStore";
interface TrainingEngineProps {
	recordId: string;
	children: ReactNode;
}

function TrainingBootSkeleton() {
	return (
		<Center h="100dvh">
			<LoadingSkeleton variant="spinner" message="正在准备训练场景…" />
		</Center>
	);
}

export function TrainingEngine({ recordId, children }: TrainingEngineProps) {
	const recordNum = Number(recordId);
	const { error: toastError, warning: toastWarning } = useToast();
	const queryClient = useQueryClient();

	// ── Read raw data from RQ-backed context (single source: TrainingEntry's query) ──
	const patient = usePatientData();
	const trainingType = useTrainingType();
	const capabilities = useRecordCapabilities();
	const initialMessages = useInitialMessages();
	const timeLimit = useTimeLimit();
	const emotionSeed = useEmotionSeed();
	const sceneSeed = useSceneSeed();
	const recordStatus = useRecordStatus();
	const recordDetail = useRecordAsDetail();

	// ── Services (refs — not in store) ──
	const busRef = useRef(createMessageBus());
	const streamRef = useRef(new StreamManager(recordNum));
	const scoreRef = useRef(new ScoreManager(recordNum, busRef.current));
	const ttsRef = useRef(new TTSManager({ autoPlay: true, recordId: recordNum }));
	const patientAccRef = useRef("");
	const endingRef = useRef(false);
	const toolBridgeReady = useToolBridge(busRef.current);

	// ── Init store before rendering store-backed training children ──
	const [readyRecordId, setReadyRecordId] = useState<string | null>(null);
	useEffect(() => {
		if (!patient) {
			setReadyRecordId(null);
			return;
		}
		const store = getTrainingState();
		store.init({
			bus: busRef.current,
			recordId,
			patient,
			trainingType,
			capabilities,
			timeLimitMinutes: timeLimit,
			recordDetail,
			initialMessages,
			emotionSeed,
		});
		setReadyRecordId(recordId);
	}, [
		recordId, patient, trainingType, capabilities, timeLimit,
		recordDetail, initialMessages, emotionSeed,
	]);

	// ── TTS attach ──
	useEffect(() => {
		ttsRef.current.attach(busRef.current);
		return () => ttsRef.current.detach();
	}, []);

	// ── Stream / Score lifecycle ──
	useEffect(() => {
		streamRef.current.setRecordId(recordNum);
		scoreRef.current.setRecordId(recordNum);
		return () => {
			streamRef.current.dispose();
			scoreRef.current.dispose();
		};
	}, [recordNum]);

	useEffect(() => {
		ttsRef.current.setRecordId(recordNum);
	}, [recordNum]);

	// 暂时停用动态病人头像：论文截图使用稳定的 PNG 真人风格头像。
	useEffect(() => {
		if (patient) {
			getTrainingState().setPortraitUrl(getPatientAvatar(patient));
		}
	}, [patient]);

	const flushNursingRecord = useCallback(async () => {
		const store = getTrainingState();
		if (
			capabilities.nursing_record &&
			store.nursingRecordDirty &&
			store.nursingRecordDraft
		) {
			const snapshot = { ...store.nursingRecordDraft };
			busRef.current.emit("tool:invoke", {
				tool: "nursing_record",
				action: "save",
				params: { sheet_data: snapshot, status: "draft" },
				recordId: recordNum,
			});
			await waitForPendingToolCommands(recordNum, "nursing_record");
			store.markNursingRecordSaved(snapshot);
			return;
		}
		await waitForPendingToolCommands(recordNum, "nursing_record");
	}, [capabilities.nursing_record, recordNum]);

	// ── 患者中止访谈（内生 GAMEOVER）──
	// 服务端在同一轮里已完成 finalize 并触发评分，前端只做本地收尾与提示：
	// 绝不能再调 /end（那会因「训练已结束」报错）。
	const handlePatientWalkout = useCallback(() => {
		getTrainingState().setTrainingEnded(true);
		busRef.current.emit("training:ended");
		queryClient.invalidateQueries({ queryKey: queryKeys.training.all });
		queryClient.invalidateQueries({ queryKey: queryKeys.assignments.student() });
		queryClient.invalidateQueries({ queryKey: queryKeys.notifications.all });
		toastWarning("患者已中止本次访谈，训练已提交评分");
	}, [queryClient, toastWarning]);

	// ── sendMessage (SSE orchestration + bus events) ──
	const trainingStartedRef = useRef(false);
	const sendMessage = useCallback(
		async (text: string) => {
			try {
				await flushNursingRecord();
			} catch {
				toastError("护理记录保存失败，请保存后再继续问诊");
				return;
			}
			trainingStartedRef.current = true;
			const bus = busRef.current;
			bus.emit("chat:beforeSend");
			await streamRef.current.send(text, {
				onPatientChunk: (chunk: string) => {
					patientAccRef.current += chunk;
					bus.emit("stream:chunk", chunk);
				},
				onPatientDone: (_replyId, done) => {
					const txt = patientAccRef.current;
					bus.emit("stream:done", txt);
					patientAccRef.current = "";
					if (done?.end_reason === "patient_walkout") handlePatientWalkout();
				},
				onError: (err) => bus.emit("stream:error", err),
				onEmotionChange: (change) => bus.emit("emotion:changed", change),
				onInitiativeState: (data) => bus.emit("initiative:state", data),
			});
		},
		[flushNursingRecord, handlePatientWalkout, toastError],
	);

	const correctLastMessage = useCallback(
		async (messageId: string | number, text: string) => {
			try {
				await flushNursingRecord();
			} catch {
				toastError("护理记录保存失败，请保存后再修正消息");
				return;
			}
			const bus = busRef.current;
			patientAccRef.current = "";
			bus.emit("chat:beforeSend");
			await streamRef.current.correctLastMessage(messageId, text, {
				onPatientChunk: (chunk: string) => {
					patientAccRef.current += chunk;
					bus.emit("stream:chunk", chunk);
				},
				onPatientDone: (_replyId, done) => {
					const txt = patientAccRef.current;
					bus.emit("stream:done", txt);
					patientAccRef.current = "";
					if (done?.end_reason === "patient_walkout") handlePatientWalkout();
				},
				onError: (err) => bus.emit("stream:error", err),
				onEmotionChange: (change) => bus.emit("emotion:changed", change),
				onInitiativeState: (data) => bus.emit("initiative:state", data),
			});
		},
		[flushNursingRecord, handlePatientWalkout, toastError],
	);

	const getProgress = useCallback(
		() => scoreRef.current?.progress ?? { phase: null, percentage: 0, message: "" },
		[],
	);

	const subscribeProgress = useCallback(
		(fn: () => void) => scoreRef.current?.subscribe(fn) ?? (() => {}),
		[],
	);

	const endTraining = useCallback(async () => {
		if (endingRef.current) return;
		endingRef.current = true;
		try {
			await flushNursingRecord();
			await scoreRef.current.end();
			getTrainingState().setTrainingEnded(true);
			busRef.current.emit("training:ended");
			queryClient.invalidateQueries({ queryKey: queryKeys.training.all });
			queryClient.invalidateQueries({ queryKey: queryKeys.assignments.student() });
			queryClient.invalidateQueries({ queryKey: queryKeys.notifications.all });
		} catch {
			toastError("护理记录或训练提交失败，请重试");
			throw new Error("训练提交失败");
		} finally {
			endingRef.current = false;
		}
	}, [flushNursingRecord, toastError, queryClient]);

	const leaveTraining = useCallback(async () => {
		try {
			await flushNursingRecord();
		} catch {
			toastError("护理记录保存失败，请重试后再离开");
			throw new Error("护理记录保存失败");
		}
	}, [flushNursingRecord, toastError]);

	const retryScoring = useCallback(async () => {
		try {
			await scoreRef.current.retry();
		} catch {
			toastError("重新触发评分失败，请稍后再试");
			throw new Error("retry scoring failed");
		}
	}, [toastError]);

	// ── Bus → Store (emotion, portrait, voice, stream errors) ──
	useEffect(() => {
		const unsubs: Array<() => void> = [];

		unsubs.push(busRef.current.on(
			"emotion:changed",
			(data: {
				state?: string;
				trust?: number;
				comfort?: number;
				anxiety?: number;
				irritation?: number;
				cooperation?: number;
				dominant_state?: string;
			}) => {
				const store = getTrainingState();
				// 4D 格式优先
				if (data.anxiety != null && data.irritation != null && data.cooperation != null) {
					store.setEmotion4D(
						data.trust ?? 50,
						data.anxiety,
						data.irritation,
						data.cooperation,
						(data.dominant_state as Emotion4DLabel) ?? "neutral",
					);
					return;
				}
				// 回退：v2 格式
				store.setEmotion(
					Object.hasOwn(EMOTION_LABELS, data.state ?? "")
						? (data.state as EmotionState)
						: "neutral",
				);
				if (data.trust != null && data.comfort != null) {
					store.setTrustComfort(data.trust, data.comfort);
				}
			},
		));

		unsubs.push(busRef.current.on("stream:error", (err: string) => {
			toastError(err || "发送消息失败，请重试");
		}));

		return () => { for (const u of unsubs) u(); };
	}, [toastError, patient]);

	// ── Seed emotion / scene from server ──
	const emotionSeededRef = useRef(false);
	useEffect(() => {
		if (emotionSeededRef.current || !emotionSeed) return;
		busRef.current.emit("emotion:changed", emotionSeed);
		emotionSeededRef.current = true;
	}, [emotionSeed]);

	const sceneSeededRef = useRef(false);
	useEffect(() => {
		if (sceneSeededRef.current || !sceneSeed) return;
		busRef.current.emit("scene:state", sceneSeed);
		sceneSeededRef.current = true;
	}, [sceneSeed]);

	// ── Check completed status ──
	useEffect(() => {
		if (recordStatus === "completed") {
			getTrainingState().setTrainingEnded(true);
		}
	}, [recordStatus]);

	// ── TTS toggle (keeps TTSManager in sync) ──
	const toggleTts = useCallback(() => {
		const store = getTrainingState();
		const next = !store.ttsAutoPlay;
		store.setTtsAutoPlay(next);
		ttsRef.current.setAutoPlay(next);
		if (!next) ttsRef.current.stop();
	}, []);

	// ── TTS auto-play on first patient message ──
	const firstGreetingRef = useRef(false);
	const ttsAutoPlay = useTrainingStore((s) => s.ttsAutoPlay);
	const messages = useTrainingStore((s) => s.messages);
	useEffect(() => {
		if (firstGreetingRef.current || !ttsAutoPlay || !trainingStartedRef.current) return;
		const firstPatient = messages.find((m) => m.role === "patient");
		if (!firstPatient) return;
		firstGreetingRef.current = true;
		ttsRef.current.speak(firstPatient.content);
	}, [messages, ttsAutoPlay]);

	const isShort = useShortViewport();
	const isMobile = useIsMobile();

	if (!patient || readyRecordId !== recordId || !toolBridgeReady) {
		return <TrainingBootSkeleton />;
	}

	return (
		<Flex flex={1} mih={0} pos="relative">
			<Flex direction="column" flex={1} miw={0}>
				<TrainingHeader
					toggleTts={toggleTts}
					endTraining={endTraining}
					leaveTraining={leaveTraining}
				/>
				{/* 三区布局：患者区 | 对话区（工具区 = children）
				    顶栏为 absolute 全宽 chrome——内容行按顶栏高度退避（isShort 同步 h-9/11/12）
				    移动端纵向堆叠（患者区在上可折叠，对话区在下）；桌面横向三列 */}
				<Flex
					flex={1}
					mih={0}
					pos="relative"
					pt={isShort ? 36 : { base: 44, xs: 48 }}
					direction={{ base: "column", sm: "row" }}
					style={{ overflow: "hidden" }}
				>
					<PatientStage />
					<Flex
						direction="column"
						flex={1}
						mih={0}
						miw={0}
						style={{
							borderTop: isMobile
								? "1px solid var(--mantine-color-gray-3)"
								: undefined,
						}}
					>
						<ErrorBoundary
							fallback={
								<Stack
									align="center"
									justify="center"
									gap={8}
									p="xl"
									h="100%"
									c="dimmed"
									ta="center"
								>
									<Text size="sm" fw={500}>对话区渲染出错</Text>
									<Text size="xs">请刷新页面继续训练（其余功能不受影响）</Text>
								</Stack>
							}
						>
							<ChatArea
								onSend={sendMessage}
								onCorrectLast={correctLastMessage}
							/>
						</ErrorBoundary>
					</Flex>
				</Flex>
			</Flex>
			{children}
			<ScoringOverlay
				bus={busRef.current}
				getProgress={getProgress}
				subscribeProgress={subscribeProgress}
				onRetry={retryScoring}
			/>
			<ScoreCard bus={busRef.current} recordId={recordId} />
		</Flex>
	);
}
