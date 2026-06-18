import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useToast } from "@/components/Toast";
import { ChatArea } from "@/components/training/ChatArea";
import { PanelHost } from "@/components/training/PanelHost";
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

	const endTraining = useCallback(async () => {
		try {
			await scoreRef.current.end();
		} catch {
			// end() 已更新 UI 为失败状态，继续发出事件以允许 overlay 显示
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
			<div
				className="grid h-screen"
				style={{
					gridTemplateAreas: '"header header" "content panel"',
					gridTemplateColumns: "1fr auto",
					gridTemplateRows: "auto 1fr",
				}}
			>
				<div className="p-4 border-b" style={{ gridArea: "header" }}>
					<LoadingSkeleton variant="stats" />
				</div>
				<div className="p-4" style={{ gridArea: "content" }}>
					<LoadingSkeleton variant="card" />
				</div>
				<div className="w-[420px] p-4 border-l" style={{ gridArea: "panel" }}>
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

	const panelPluginsWrapped = activePanels.map((p) => ({
		id: p.id,
		meta: { name: p.label },
		tab: { icon: p.icon, label: p.label, badge: p.badge },
		component: (props: unknown) => (
			<PluginErrorBoundary pluginName={p.label}>
				<p.component {...(props as any)} />
			</PluginErrorBoundary>
		),
	}));

	return (
		<>
			<div
				className="h-screen"
				style={{
					display: "grid",
					gridTemplateAreas: '"header header" "content panel"',
					gridTemplateColumns: "1fr auto",
					gridTemplateRows: "auto 1fr",
				}}
			>
				<div style={{ gridArea: "header" }}>
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
				</div>
				<div style={{ gridArea: "content", overflow: "hidden" }}>
					<ChatArea
						messages={messages}
						patient={patient}
						sending={sending}
						onSend={sendMessage}
						bus={busRef.current}
						features={features}
					/>
				</div>
				<div style={{ gridArea: "panel", overflow: "hidden" }}>
					<PanelHost
						ctx={ctx}
						features={features}
						plugins={panelPluginsWrapped}
					/>
				</div>
			</div>
			<ScoringOverlay
				bus={busRef.current}
				getProgress={() => scoreRef.current?.progress ?? { phase: null, percentage: 0, message: "" }}
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
