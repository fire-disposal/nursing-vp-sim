import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { queryKeys } from "@/api/query-keys";
import { getRecordDetail } from "@/api/training";
import ErrorBoundary from "@/components/ErrorBoundary";
import { useToast } from "@/components/Toast";
import { ChatArea } from "@/components/training/ChatArea";
import { ScoreCard, ScoringOverlay } from "@/components/training/panels/scoring-display";
import { TrainingHeader } from "@/components/training/TrainingHeader";
import LoadingSkeleton from "@/components/ui/loading-skeleton";
import { getPatientPortraitUrl } from "@/utils/patient-portrait";
import { createMessageBus } from "./MessageBus";
import type { EmotionState } from "./PanelContext";
import {
	EMOTION_LABELS,
	PanelStateProvider,
	useEmotion,
	usePortrait,
} from "./PanelContext";
import { PatientProvider, usePatient } from "./PatientProvider";
import { ScoreManager } from "./ScoreManager";
import { StreamManager } from "./StreamManager";
import TrainingContext from "./TrainingContext";
import { TTSManager } from "./tts/TTSManager";
import type {
	ChatMessage,
	PanelContext,
} from "./types";

interface TrainingEngineProps {
	recordId: string;
	children?: ReactNode;
}

function useFeatureToggles(initialFeatures: Record<string, boolean>) {
	const [features, setFeatures] =
		useState<Record<string, boolean>>(initialFeatures);

	useEffect(() => {
		setFeatures(initialFeatures);
	}, [initialFeatures]);

	const toggleFeature = useCallback((key: string, enabled: boolean) => {
		setFeatures((prev) => {
			const next = { ...prev, [key]: enabled };
			if (!enabled && key === "emotion") {
				next.patient_initiative = false;
			}
			return next;
		});
	}, []);

	return { features, toggleFeature } as const;
}

function TrainingEngineContent({ recordId, children }: TrainingEngineProps) {
	const {
		patient,
		trainingType,
		loading,
		error: patientError,
		features: initialFeatures,
		fromAssignment,
		initialMessages,
		timeLimit,
		remainingSeconds,
	} = usePatient();
	const recordNum = Number(recordId);
	const { error: toastError } = useToast();

	const busRef = useRef(createMessageBus());
	const streamRef = useRef(new StreamManager(recordNum));
	const scoreRef = useRef(new ScoreManager(recordNum, busRef.current));
	const ttsRef = useRef(new TTSManager({ autoPlay: false, recordId: recordNum }));
	const seededRef = useRef(false);
	const patientAccRef = useRef("");

	const { setEmotion } = useEmotion();
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

	const { features, toggleFeature } =
		useFeatureToggles(initialFeatures);

	useEffect(() => {
		if (initialMessages.length > 0 && !seededRef.current) {
			seededRef.current = true;
			streamRef.current.setMessages(initialMessages);
		}
	}, [initialMessages]);

	useEffect(() => {
		streamRef.current.setRecordId(recordNum);
		const unsub = streamRef.current.subscribe(() =>
			setMessages([...streamRef.current.getMessages()]),
		);
		const unsubLoading = streamRef.current.onLoadingChange(setSending);
		return () => {
			unsub();
			unsubLoading();
			streamRef.current.dispose();
		};
	}, [recordNum]);

	useEffect(() => {
		scoreRef.current.setRecordId(recordNum);
		return () => scoreRef.current.dispose();
	}, [recordNum]);

	useEffect(() => {
		ttsRef.current.setRecordId(recordNum);
	}, [recordNum]);

	useEffect(() => {
		if (patient) {
			setPortraitUrl(getPatientPortraitUrl(patient, null));
		}
	}, [patient, setPortraitUrl]);


	const sendMessage = useCallback(
		async (text: string) => {
			const bus = busRef.current;
			patientAccRef.current = "";
			bus.emit("chat:beforeSend");
			streamRef.current.send(text, {
				onPatientChunk: (chunk: string) => {
					patientAccRef.current += chunk;
					bus.emit("stream:chunk");
				},
				onPatientDone: () => {
					const text = patientAccRef.current;
					bus.emit("stream:done", text);
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
		setTrainingEnded(true);
		try {
			await scoreRef.current.end();
		} catch {
		}
		busRef.current.emit("training:ended");
	}, []);

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

	useEffect(() => {
		return busRef.current.on(
			"emotion:changed",
			(data: { state: string }) => {
				setEmotion((data.state in EMOTION_LABELS ? data.state : "neutral") as EmotionState);
				if (patient) {
					setPortraitUrl(getPatientPortraitUrl(patient, data.state));
				}
			},
		);
	}, [setEmotion, setPortraitUrl, patient]);

	useEffect(() => {
		return busRef.current.on(
			"initiative:triggered",
			(data: { content: string }) => {
				streamRef.current.addPatientMessage(data.content);
			},
		);
	}, []);

	// 继续训练：回填服务器端持久化的情绪(信赖/舒适/状态)，仅一次。
	const { data: _restoreRecord } = useQuery({
		queryKey: queryKeys.training.record(String(recordNum)),
		queryFn: () => getRecordDetail(recordNum).then((r) => r.data),
		enabled: recordNum > 0,
	});
	const emotionSeededRef = useRef(false);
	useEffect(() => {
		if (emotionSeededRef.current || !_restoreRecord) return;
		const em = (_restoreRecord as unknown as {
			emotion?: { trust?: number; comfort?: number; state?: string };
		}).emotion;
		if (em && typeof em.trust === "number" && typeof em.comfort === "number") {
			busRef.current.emit("emotion:changed", {
				state: em.state ?? "neutral",
				trust: em.trust,
				comfort: em.comfort,
			});
		}
		emotionSeededRef.current = true;
	}, [_restoreRecord]);

	useEffect(() => {
		return busRef.current.on("stream:error", (err: string) => {
			toastError(err || "发送消息失败，请重试");
		});
	}, [toastError]);

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
	}, [ttsAutoPlay]);

	const ctxValue = useMemo(
		() => ({
			bus: busRef.current,
			recordId,
			trainingType,
			patient: patient!,
			messages,
			features,
			ttsAutoPlay,
			sending,
			featuresLocked: !!fromAssignment,
			fromAssignment: !!fromAssignment,
			timeLimitMinutes: timeLimit,
			remainingSeconds,
			voiceStatus,
			toggleFeature,
			toggleTts: toggleTtsCb,
			endTraining,
		}),
		[
			recordId,
			trainingType,
			patient,
			messages,
			features,
			ttsAutoPlay,
			sending,
			fromAssignment,
			timeLimit,
			remainingSeconds,
			voiceStatus,
			toggleFeature,
			toggleTtsCb,
			endTraining,
		],
	);

	if (loading) {
		return (
			<div className="flex flex-col h-screen">
				<div className="p-3 border-b shrink-0">
					<LoadingSkeleton variant="stats" />
				</div>
				<div className="flex-1 p-4 overflow-hidden">
					<LoadingSkeleton variant="card" />
				</div>
			</div>
		);
	}

	if (!patient) {
		return (
			<div className="flex h-screen items-center justify-center text-muted-foreground">
				{patientError || "患者信息加载失败"}
			</div>
		);
	}
	return (
		<>
		<TrainingContext.Provider value={ctxValue}>
			<div className="flex flex-1 min-h-0">
				<div className="flex flex-col flex-1 min-w-0">
				<TrainingHeader />
				<div className="flex-1 overflow-hidden relative">
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
							features={features}
							recordId={recordNum}
							hasHistory={initialMessages.length > 0}
						/>
					</ErrorBoundary>
				</div>
				</div>
				{children}
			</div>
		</TrainingContext.Provider>
			<ScoringOverlay
				bus={busRef.current}
				getProgress={getProgress}
				subscribeProgress={subscribeProgress}
			/>
			<ScoreCard bus={busRef.current} recordId={recordId} />
		</>
	);
}

export function TrainingEngine(props: TrainingEngineProps) {
	return (
		<PatientProvider recordId={props.recordId}>
			<PanelStateProvider>
				<TrainingEngineContent {...props} />
			</PanelStateProvider>
		</PatientProvider>
	);
}
