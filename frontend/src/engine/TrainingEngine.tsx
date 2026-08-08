import type { ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import ErrorBoundary from "@/components/ErrorBoundary";
import { useToast } from "@/components/Toast";
import { ChatArea } from "@/components/training/ChatArea";
import PatientStage from "@/components/training/PatientStage";
import { ScoreCard, ScoringOverlay } from "@/components/training/scoring";
import { TrainingHeader } from "@/components/training/TrainingHeader";
import { getPatientAvatar } from "@/utils/avatar";
// 暂停使用基于情绪切换的人像变体，保留实现以便后续恢复。
// import { getPatientPortraitUrl } from "@/utils/patient-portrait";
import { useShortViewport } from "@/hooks/useShortViewport";
import { cn } from "@/lib/utils";
import { useToolBridge, waitForPendingToolRequests } from "@/hooks/useToolBridge";
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
	useStartTime,
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
		<div
			className="flex h-screen items-center justify-center bg-background text-sm text-muted-foreground"
			style={{ height: "100dvh" }}
		>
			<div className="space-y-3 text-center">
				<div className="mx-auto size-8 animate-pulse rounded-full bg-primary/20" />
				<div>正在准备训练场景…</div>
			</div>
		</div>
	);
}

export function TrainingEngine({ recordId, children }: TrainingEngineProps) {
	const recordNum = Number(recordId);
	const { error: toastError } = useToast();

	// ── Read raw data from RQ-backed context (single source: TrainingEntry's query) ──
	const patient = usePatientData();
	const trainingType = useTrainingType();
	const capabilities = useRecordCapabilities();
	const initialMessages = useInitialMessages();
	const timeLimit = useTimeLimit();
	const startTime = useStartTime();
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
	useToolBridge(busRef.current);

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
			startTime,
			emotionSeed,
		});
		setReadyRecordId(recordId);
	}, [
		recordId, patient, trainingType, capabilities, timeLimit,
		recordDetail, initialMessages, startTime, emotionSeed,
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

	// ── sendMessage (SSE orchestration + bus events) ──
	const trainingStartedRef = useRef(false);
	const sendMessage = useCallback(
		async (text: string) => {
			trainingStartedRef.current = true;
			const bus = busRef.current;
			bus.emit("chat:beforeSend");
			streamRef.current.send(text, {
				onPatientChunk: (chunk: string) => {
					patientAccRef.current += chunk;
					bus.emit("stream:chunk", chunk);
				},
				onPatientDone: () => {
					const txt = patientAccRef.current;
					bus.emit("stream:done", txt);
					patientAccRef.current = "";
				},
				onError: (err) => bus.emit("stream:error", err),
				onEmotionChange: (change) => bus.emit("emotion:changed", change),
				onInitiative: (initiative) =>
					bus.emit("initiative:triggered", { content: initiative }),
				onInitiativeState: (data) => bus.emit("initiative:state", data),
			});
		},
		[],
	);

	const correctLastMessage = useCallback(
		async (messageId: string | number, text: string) => {
			const bus = busRef.current;
			patientAccRef.current = "";
			bus.emit("chat:beforeSend");
			streamRef.current.correctLastMessage(messageId, text, {
				onPatientChunk: (chunk: string) => {
					patientAccRef.current += chunk;
					bus.emit("stream:chunk", chunk);
				},
				onPatientDone: () => {
					const txt = patientAccRef.current;
					bus.emit("stream:done", txt);
					patientAccRef.current = "";
				},
				onError: (err) => bus.emit("stream:error", err),
				onEmotionChange: (change) => bus.emit("emotion:changed", change),
				onInitiative: (initiative) =>
					bus.emit("initiative:triggered", { content: initiative }),
				onInitiativeState: (data) => bus.emit("initiative:state", data),
			});
		},
		[],
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
			busRef.current.emit("training:beforeEnd");
			await waitForPendingToolRequests(busRef.current);
			await scoreRef.current.end();
			getTrainingState().setTrainingEnded(true);
			busRef.current.emit("training:ended");
		} catch {
			toastError("训练内容尚未保存，未开始结算，请重试");
		} finally {
			endingRef.current = false;
		}
	}, [toastError]);

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
					// 暂时停用动态病人头像，保留情绪状态更新。
					// if (patient && data.dominant_state) {
					// 	store.setPortraitUrl(getPatientPortraitUrl(patient, data.dominant_state));
					// }
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
				// 暂时停用动态病人头像，保留情绪状态更新。
				// if (patient && data.state) {
				// 	store.setPortraitUrl(getPatientPortraitUrl(patient, data.state));
				// }
			},
		));

		unsubs.push(busRef.current.on("stream:error", (err: string) => {
			toastError(err || "发送消息失败，请重试");
		}));

		unsubs.push(busRef.current.on(
			"tts:provider-status",
			(data: { provider: string; latencyMs: number }) => {
				getTrainingState().setVoiceStatus(data);
			},
		));

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

	if (!patient || readyRecordId !== recordId) {
		return <TrainingBootSkeleton />;
	}

	return (
		<div className="relative flex flex-1 min-h-0">
			<div className="flex flex-col flex-1 min-w-0">
				<TrainingHeader
					toggleTts={toggleTts}
					endTraining={endTraining}
				/>
				{/* 三区布局：患者区 | 对话区（工具区 = children）
				    顶栏为 absolute 全宽 chrome——内容行按顶栏高度退避（isShort 同步 h-9/11/12）
				    移动端纵向堆叠（患者区在上可折叠，对话区在下）；桌面横向三列 */}
				<div
					className={cn(
						"flex flex-1 overflow-hidden min-h-0",
						isShort ? "pt-9" : "pt-11 sm:pt-12",
						"flex-col md:flex-row",
					)}
				>
					<PatientStage />
					<div className="flex min-h-0 min-w-0 flex-1 flex-col border-t border-border md:border-l md:border-t-0">
						<ErrorBoundary
							fallback={
								<div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-muted-foreground">
									<div className="text-sm font-medium">对话区渲染出错</div>
									<div className="text-xs">请刷新页面继续训练（其余功能不受影响）</div>
								</div>
							}
						>
							<ChatArea
								onSend={sendMessage}
								endTraining={endTraining}
								onCorrectLast={correctLastMessage}
							/>
						</ErrorBoundary>
					</div>
				</div>
			</div>
			{children}
			<ScoringOverlay
				bus={busRef.current}
				getProgress={getProgress}
				subscribeProgress={subscribeProgress}
				onRetry={retryScoring}
			/>
			<ScoreCard bus={busRef.current} recordId={recordId} />
		</div>
	);
}
