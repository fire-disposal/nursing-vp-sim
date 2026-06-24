import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useToast } from "@/components/Toast";
import { ChatArea } from "@/components/training/ChatArea";
import { FloatingPanelHost } from "@/components/training/FloatingPanelHost";
import { PluginErrorBoundary } from "@/components/training/PluginErrorBoundary";
import { getActivePanels } from "@/components/training/panels";
import { ScoreCard, ScoringOverlay } from "@/components/training/panels/scoring-display";
import { TrainingHeader } from "@/components/training/TrainingHeader";
import LoadingSkeleton from "@/components/ui/loading-skeleton";
import { createMessageBus } from "./MessageBus";
import TrainingContext from "./TrainingContext";
import { PatientProvider, usePatient } from "./PatientProvider";
import type { EmotionState } from "./PluginContext";
import {
	EmotionProvider,
	PortraitProvider,
	useEmotion,
	usePortrait,
} from "./PluginContext";
import { ScoreManager } from "./ScoreManager";
import { StreamManager } from "./StreamManager";
import { TTSManager } from "./tts/TTSManager";
import type {
	ChatMessage,
	PanelTabProps,
	PluginContext,
} from "./types";
import { getPatientPortraitUrl } from "@/utils/patient-portrait";

interface TrainingEngineProps {
	recordId: string;
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

	const activePanels = useMemo(
		() => getActivePanels(features),
		[features],
	);

	return { features, toggleFeature, activePanels } as const;
}

function TrainingEngineContent({ recordId }: TrainingEngineProps) {
	const {
		patient,
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
	const ttsRef = useRef(new TTSManager({ autoPlay: true, recordId: recordNum }));
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

	const { features, toggleFeature, activePanels } =
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

	const panelPluginsWrapped = useMemo(
		() =>
			activePanels.map((p) => ({
				id: p.id,
				meta: { name: p.label },
				tab: { icon: p.icon, label: p.label, badge: p.badge },
				component: (props: PanelTabProps) => (
					<PluginErrorBoundary pluginName={p.label}>
						<p.component {...props} />
					</PluginErrorBoundary>
				),
			})),
		[activePanels],
	);

	const sendMessage = useCallback(
		async (text: string) => {
			const bus = busRef.current;
			patientAccRef.current = "";
			bus.emit("chat:beforeSend");
			streamRef.current.send(text, {
				onPatientChunk: (chunk: string) => {
					patientAccRef.current += chunk;
					bus.emit("stream:chunk");
					bus.emit("tts:prebuffer", {
						text: patientAccRef.current,
					});
				},
				onPatientDone: () => {
					bus.emit("stream:done");
					patientAccRef.current = "";
				},
				onError: (err) => bus.emit("stream:error", err),
				onExamResult: (examResult) => bus.emit("exam:result", examResult),
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

	const ctx: PluginContext = useMemo(
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
				setEmotion(data.state as EmotionState);
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
		<TrainingContext.Provider
			value={{
				recordId,
				patient,
				features,
				ttsAutoPlay,
				sending,
				featuresLocked: !!fromAssignment,
				fromAssignment: !!fromAssignment,
				timeLimitMinutes: timeLimit,
				remainingSeconds,
				voiceStatus,
				toggleFeature,
				toggleTts: () => {
					const next = !ttsAutoPlay;
					setTtsAutoPlay(next);
					ttsRef.current.setAutoPlay(next);
				},
				endTraining,
			}}
		>
			<div className="flex flex-col h-screen">
				<TrainingHeader />
				<div className="flex-1 overflow-hidden relative">
					<ChatArea
						messages={messages}
						patient={patient}
						sending={sending}
						trainingEnded={trainingEnded}
						onSend={sendMessage}
						bus={busRef.current}
						features={features}
						recordId={recordNum}
					/>
				</div>
				<FloatingPanelHost
					ctx={ctx}
					features={features}
					plugins={panelPluginsWrapped}
				/>
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
			<EmotionProvider>
				<PortraitProvider>
					<TrainingEngineContent {...props} />
				</PortraitProvider>
			</EmotionProvider>
		</PatientProvider>
	);
}
