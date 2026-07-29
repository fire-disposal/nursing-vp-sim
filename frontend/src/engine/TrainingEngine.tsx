import type { ReactNode } from "react";
import { useCallback, useEffect, useRef } from "react";
import ErrorBoundary from "@/components/ErrorBoundary";
import { useToast } from "@/components/Toast";
import { ChatArea } from "@/components/training/ChatArea";
import { ScoreCard, ScoringOverlay } from "@/components/training/scoring";
import { TrainingHeader } from "@/components/training/TrainingHeader";
import { getPatientPortraitUrl } from "@/utils/patient-portrait";
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
	useRemainingSeconds,
	useEmotionSeed,
	useSceneSeed,
	useRecordStatus,
	useRecordAsDetail,
} from "./TrainingDataContext";
import { ScoreManager } from "./ScoreManager";
import { StreamManager } from "./StreamManager";
import { TTSManager } from "./tts/TTSManager";
import type { EmotionState } from "@/stores/trainingStore";
import { EMOTION_LABELS } from "@/stores/trainingStore";

interface TrainingEngineProps {
	recordId: string;
	children: ReactNode;
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
	const remainingSec = useRemainingSeconds();
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

	// ── Init store once on mount / record change ──
	const initedRef = useRef(false);
	useEffect(() => {
		if (!patient) return;
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
			remainingSeconds: remainingSec,
			emotionSeed,
		});
		initedRef.current = true;
	}, [
		recordId, patient, trainingType, capabilities, timeLimit,
		recordDetail, initialMessages, remainingSec, emotionSeed,
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

	// ── Portrait ──
	useEffect(() => {
		if (patient) {
			getTrainingState().setPortraitUrl(getPatientPortraitUrl(patient, null));
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
			(data: { state: string; trust?: number; comfort?: number }) => {
				const store = getTrainingState();
				store.setEmotion(
					Object.hasOwn(EMOTION_LABELS, data.state)
						? (data.state as EmotionState)
						: "neutral",
				);
				if (data.trust != null && data.comfort != null) {
					store.setTrustComfort(data.trust, data.comfort);
				}
				if (patient) {
					store.setPortraitUrl(getPatientPortraitUrl(patient, data.state));
				}
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

	if (!patient) {
		return (
			<div className="flex h-screen items-center justify-center text-muted-foreground" style={{ height: "100dvh" }}>
				患者信息加载失败 — 请返回重试或刷新页面
			</div>
		);
	}

	return (
		<div className="flex flex-1 min-h-0">
			<div className="flex flex-col flex-1 min-w-0">
				<TrainingHeader
					toggleTts={toggleTts}
					endTraining={endTraining}
				/>
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
							onSend={sendMessage}
							endTraining={endTraining}
						/>
					</ErrorBoundary>
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
