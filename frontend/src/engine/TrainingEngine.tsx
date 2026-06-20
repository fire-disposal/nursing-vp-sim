import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useToast } from "@/components/Toast";
import { ChatArea } from "@/components/training/ChatArea";
import { FloatingPanelHost } from "@/components/training/FloatingPanelHost";
import { PluginErrorBoundary } from "@/components/training/PluginErrorBoundary";
import { getActivePanels } from "@/components/training/panels";
import { ScoreCard, ScoringOverlay } from "@/components/training/panels/scoring-display";
import { TrainingHeader } from "@/components/training/TrainingHeader";
import LoadingSkeleton from "@/components/ui/LoadingSkeleton";
import { createMessageBus } from "./MessageBus";
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

interface TrainingEngineProps {
	recordId: string;
}

function TrainingEngineContent({ recordId }: TrainingEngineProps) {
	const {
		patient,
		loading,
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
	const ttsRef = useRef(new TTSManager({ autoPlay: true }));
	const seededRef = useRef(false);

	const { setEmotion } = useEmotion();
	const { setPortraitUrl } = usePortrait();

	useEffect(() => {
		ttsRef.current.attach(busRef.current);
		return () => ttsRef.current.detach();
	}, []);

	const [messages, setMessages] = useState<ChatMessage[]>([]);
	const [sending, setSending] = useState(false);
	const [ttsAutoPlay, setTtsAutoPlay] = useState(true);
	const [features, setFeatures] =
		useState<Record<string, boolean>>(initialFeatures);

	useEffect(() => {
		setFeatures(initialFeatures);
	}, [initialFeatures]);

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
		};
	}, [recordNum]);

	useEffect(() => {
		scoreRef.current.setRecordId(recordNum);
		return () => scoreRef.current.dispose();
	}, [recordNum]);

	const activePanels = useMemo(
		() => getActivePanels(features),
		[features],
	);

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
			streamRef.current.send(text, {
				onPatientChunk: () => bus.emit("stream:chunk"),
				onPatientDone: () => bus.emit("stream:done"),
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

	const endTraining = useCallback(async () => {
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
			tts: { isAutoPlay: ttsAutoPlay, setAutoPlay: setTtsAutoPlay },
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
			},
		);
	}, [setEmotion]);

	useEffect(() => {
		return busRef.current.on(
			"portrait:changed",
			(data: { url: string }) => {
				setPortraitUrl(data.url);
			},
		);
	}, [setPortraitUrl]);

	useEffect(() => {
		return busRef.current.on("stream:error", (err: string) => {
			toastError(err || "发送消息失败，请重试");
		});
	}, [toastError]);

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
				患者信息加载失败
			</div>
		);
	}

	return (
		<>
			<div className="flex flex-col h-screen">
				<TrainingHeader
					recordId={recordId}
					patient={patient}
					features={features}
					onToggleFeature={(key: string, enabled: boolean) => {
						setFeatures((prev) => {
							const next = { ...prev, [key]: enabled };
							if (!enabled && key === "emotion") {
								next.patient_initiative = false;
							}
							return next;
						});
					}}
					ttsAutoPlay={ttsAutoPlay}
					onTtsToggle={() => setTtsAutoPlay((v) => !v)}
					onEnd={endTraining}
					sending={sending}
					featuresLocked={fromAssignment}
					fromAssignment={fromAssignment}
					timeLimitMinutes={timeLimit}
					remainingSeconds={remainingSeconds}
				/>
				<div className="flex-1 overflow-hidden relative">
					<ChatArea
						messages={messages}
						patient={patient}
						sending={sending}
						onSend={sendMessage}
						bus={busRef.current}
						features={features}
					/>
				</div>
				<FloatingPanelHost
					ctx={ctx}
					features={features}
					plugins={panelPluginsWrapped}
				/>
			</div>
			<ScoringOverlay
				bus={busRef.current}
				getProgress={getProgress}
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
