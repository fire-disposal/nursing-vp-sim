import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ErrorBoundary from "@/components/ErrorBoundary";
import { useToast } from "@/components/Toast";
import { ChatArea } from "@/components/training/ChatArea";
import { ScoreCard, ScoringOverlay } from "@/components/training/scoring";
import { TrainingHeader } from "@/components/training/TrainingHeader";
import { getPatientPortraitUrl } from "@/utils/patient-portrait";
import { useToolBridge, waitForPendingToolRequests } from "@/hooks/useToolBridge";
import { createMessageBus } from "./MessageBus";
import type { EmotionState } from "./PanelContext";
import {
	EMOTION_LABELS,
	PanelStateProvider,
	useEmotion,
	usePortrait,
} from "./PanelContext";
import { PatientProvider } from "./PatientProvider";
import { ScoreManager } from "./ScoreManager";
import { StreamManager } from "./StreamManager";
import {
	TrainingDynamicProvider,
	TrainingStaticProvider,
	TrainingUIStateProvider,
} from "./TrainingLayerContexts";
import {
	useEmotionSeed,
	useInitialMessages,
	usePatientData,
	useRecordAsDetail,
	useRecordCapabilities,
	useRecordStatus,
	useRemainingSeconds,
	useSceneSeed,
	useTimeLimit,
	useTrainingType,
} from "./TrainingDataContext";
import { TTSManager } from "./tts/TTSManager";
import type {
	ChatMessage,
	PanelContext,
} from "./types";

interface TrainingEngineProps {
	recordId: string;
	children?: ReactNode;
}

function TrainingEngineContent({ recordId, children }: TrainingEngineProps) {
	const recordNum = Number(recordId);
	const { error: toastError } = useToast();

	// ── Data from context (single source: TrainingEntry's query) ──
	const patient = usePatientData();
	const trainingType = useTrainingType();
	const capabilities = useRecordCapabilities();
	const initialMessages = useInitialMessages();
	const timeLimit = useTimeLimit();
	const remainingSec = useRemainingSeconds();
	const emotionSeed = useEmotionSeed();
	const sceneSeed = useSceneSeed();
	const recordStatus = useRecordStatus();
	const recordDetail = useRecordAsDetail();

	// ── Services ──
	const busRef = useRef(createMessageBus());
	const streamRef = useRef(new StreamManager(recordNum));
	const scoreRef = useRef(new ScoreManager(recordNum, busRef.current));
	const ttsRef = useRef(new TTSManager({ autoPlay: true, recordId: recordNum }));
	const patientAccRef = useRef("");
	useToolBridge(busRef.current);
	const endingRef = useRef(false);

	const { setEmotion, setTrustComfort } = useEmotion();
	const { setPortraitUrl } = usePortrait();

	useEffect(() => {
		ttsRef.current.attach(busRef.current);
		return () => ttsRef.current.detach();
	}, []);

	const [messages, setMessages] = useState<ChatMessage[]>([]);
	const [sending, setSending] = useState(false);
	const [ttsAutoPlay, setTtsAutoPlay] = useState(true);
	const [trainingEnded, setTrainingEnded] = useState(false);
	const [voiceStatus, setVoiceStatus] = useState<{
		provider: string;
		latencyMs: number;
	} | null>(null);

	// ── Merge initial messages from server ──
	useEffect(() => {
		if (initialMessages.length > 0) {
			streamRef.current.mergeHistory(initialMessages);
		}
	}, [initialMessages]);

	// ── Stream lifecycle ──
	useEffect(() => {
		streamRef.current.setRecordId(recordNum);
		const unsub = streamRef.current.subscribe(() =>
			setMessages([...streamRef.current.getMessages()]),
		);
		const unsubLoading = streamRef.current.onLoadingChange(setSending);
		setMessages([...streamRef.current.getMessages()]);
		setSending(streamRef.current.loading);
		return () => {
			unsub();
			unsubLoading();
			streamRef.current.dispose();
		};
	}, [recordNum]);

	// TTS auto-play: wait until training actually starts (first student message sent)
	const trainingStartedRef = useRef(false);
	const firstGreetingRef = useRef(false);
	useEffect(() => {
		if (firstGreetingRef.current || !ttsAutoPlay || !trainingStartedRef.current) return;
		const firstPatient = messages.find((m) => m.role === "patient");
		if (!firstPatient) return;
		firstGreetingRef.current = true;
		ttsRef.current.speak(firstPatient.content);
	}, [messages, ttsAutoPlay]);

	// ── Score/TTS lifecycle ──
	useEffect(() => {
		scoreRef.current.setRecordId(recordNum);
		return () => scoreRef.current.dispose();
	}, [recordNum]);

	useEffect(() => {
		ttsRef.current.setRecordId(recordNum);
	}, [recordNum]);

	// ── Portrait ──
	useEffect(() => {
		if (patient) {
			setPortraitUrl(getPatientPortraitUrl(patient, null));
		}
	}, [patient, setPortraitUrl]);

	// ── sendMessage ──
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
			setTrainingEnded(true);
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

	const _ctx: PanelContext = useMemo(
		() => ({
			recordId,
			bus: busRef.current,
			patient: patient!,
			messages,
			loading: sending,
			tts: {
				isAutoPlay: ttsAutoPlay,
				setAutoPlay: (on: boolean) => {
					setTtsAutoPlay(on);
					ttsRef.current.setAutoPlay(on);
				},
			},
			sendMessage,
			endTraining,
		}),
		[
			recordId,
			patient,
			messages,
			sending,
			ttsAutoPlay,
			sendMessage,
			endTraining,
		],
	);

	// ── Emotion changes ──
	useEffect(() => {
		return busRef.current.on(
			"emotion:changed",
			(data: { state: string; trust?: number; comfort?: number }) => {
				setEmotion((data.state in EMOTION_LABELS ? data.state : "neutral") as EmotionState);
				if (data.trust != null && data.comfort != null) {
					setTrustComfort(data.trust, data.comfort);
				}
				if (patient) {
					setPortraitUrl(getPatientPortraitUrl(patient, data.state));
				}
			},
		);
	}, [setEmotion, setTrustComfort, setPortraitUrl, patient]);

	// ── Seed emotion from server (was _restoreRecord query) ──
	const emotionSeededRef = useRef(false);
	useEffect(() => {
		if (emotionSeededRef.current || !emotionSeed) return;
		busRef.current.emit("emotion:changed", emotionSeed);
		emotionSeededRef.current = true;
	}, [emotionSeed]);

	// ── Seed scene state from server ──
	const sceneSeededRef = useRef(false);
	useEffect(() => {
		if (sceneSeededRef.current || !sceneSeed) return;
		busRef.current.emit("scene:state", sceneSeed);
		sceneSeededRef.current = true;
	}, [sceneSeed]);

	// ── Check completed status ──
	useEffect(() => {
		if (recordStatus === "completed") {
			setTrainingEnded(true);
		}
	}, [recordStatus]);

	// ── Stream error toast ──
	useEffect(() => {
		return busRef.current.on("stream:error", (err: string) => {
			toastError(err || "发送消息失败，请重试");
		});
	}, [toastError]);

	// ── TTS provider status ──
	useEffect(() => {
		return busRef.current.on(
			"tts:provider-status",
			(data: { provider: string; latencyMs: number }) => {
				setVoiceStatus(data);
			},
		);
	}, []);

	const toggleTtsCb = useCallback(() => {
		const next = !ttsAutoPlay;
		setTtsAutoPlay(next);
		ttsRef.current.setAutoPlay(next);
		if (!next) ttsRef.current.stop();
	}, [ttsAutoPlay]);

	// ── Split context values ──
	const staticCtx = useMemo(
		() => ({
			bus: busRef.current,
			recordId,
			patient: patient!,
			trainingType,
			capabilities,
			timeLimitMinutes: timeLimit,
			recordDetail,
		}),
		[recordId, patient, trainingType, capabilities, timeLimit, recordDetail],
	);

	const dynamicCtx = useMemo(
		() => ({ messages, sending }),
		[messages, sending],
	);

	const uiCtx = useMemo(
		() => ({
			ttsAutoPlay,
			toggleTts: toggleTtsCb,
			voiceStatus,
			remainingSeconds: remainingSec,
			endTraining,
		}),
		[ttsAutoPlay, toggleTtsCb, voiceStatus, remainingSec, endTraining],
	);

	if (!patient) {
		return (
			<div className="flex h-screen items-center justify-center text-muted-foreground" style={{ height: "100dvh" }}>
				患者信息加载失败 — 请返回重试或刷新页面
			</div>
		);
	}

	return (
		<TrainingStaticProvider value={staticCtx}>
			<TrainingDynamicProvider value={dynamicCtx}>
				<TrainingUIStateProvider value={uiCtx}>
					<div className="flex flex-1 min-h-0">
						<div className="flex flex-col flex-1 min-w-0">
							<TrainingHeader />
							<div className="flex-1 overflow-hidden relative flex flex-col min-h-0">
								<ErrorBoundary
									fallback={
										<div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-muted-foreground">
											<div className="text-sm font-medium">对话区渲染出错</div>
											<div className="text-xs">请刷新页面继续训练（其余功能不受影响）</div>
										</div>
									}
								>
									<ChatArea
										messages={messages}
										patient={patient}
										sending={sending}
										trainingEnded={trainingEnded}
										onSend={sendMessage}
										bus={busRef.current}
										capabilities={capabilities}
										recordId={recordNum}
										hasHistory={initialMessages.length > 0}
										recordDetail={recordDetail}
									/>
								</ErrorBoundary>
							</div>
						</div>
						{children}
					</div>
					<ScoringOverlay
						bus={busRef.current}
						getProgress={getProgress}
						subscribeProgress={subscribeProgress}
						onRetry={retryScoring}
					/>
					<ScoreCard bus={busRef.current} recordId={recordId} />
				</TrainingUIStateProvider>
			</TrainingDynamicProvider>
		</TrainingStaticProvider>
	);
}

export function TrainingEngine(props: TrainingEngineProps) {
	return (
		<PatientProvider>
			<PanelStateProvider>
				<TrainingEngineContent {...props} />
			</PanelStateProvider>
		</PatientProvider>
	);
}
