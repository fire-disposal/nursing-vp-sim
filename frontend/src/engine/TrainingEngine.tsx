import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useToast } from "@/components/Toast";
import { ChatArea } from "@/components/training/ChatArea";
import { PanelHost } from "@/components/training/PanelHost";
import { PluginErrorBoundary } from "@/components/training/PluginErrorBoundary";
import { ScoreCard, ScoringOverlay } from "@/components/training/panels/scoring-display";
import { TrainingHeader } from "@/components/training/TrainingHeader";
import { discoverPluginDefs } from "./discovery";
import { createMessageBus } from "./MessageBus";
import { useManifest } from "./manifest";
import { PatientProvider, usePatient } from "./PatientProvider";
import type { EmotionState } from "./PluginContext";
import {
	EmotionProvider,
	PortraitProvider,
	useEmotion,
	usePortrait,
} from "./PluginContext";
import { pluginRegistry } from "./PluginRegistry";
import { ScoreManager } from "./ScoreManager";
import { StreamManager } from "./StreamManager";
import { TTSManager } from "./tts/TTSManager";
import type {
	ChatMessage,
	FrontendPluginDef,
	PanelPlugin,
	PluginContext,
} from "./types";

interface TrainingEngineProps {
	recordId: string;
}

function buildPanelPlugin(def: FrontendPluginDef): PanelPlugin | null {
	if (!def.component || !def.tab) return null;
	return {
		id: def.id,
		meta: def.meta,
		tab: {
			icon: def.tab.icon,
			label: def.tab.label,
			badge: def.tab.badge,
			priority: def.tab.priority,
		},
		component: def.component,
		hooks: def.hooks,
	};
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
	const cleanupRefs = useRef(new Map<string, (() => void) | undefined>());
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

	const { manifest } = useManifest(recordId);
	const localDefs = useMemo(() => discoverPluginDefs(), []);

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

	useEffect(() => {
		pluginRegistry.setFeatureFlags(features);
		if (manifest) pluginRegistry.setManifest(manifest);
		const registered: string[] = [];
		for (const def of localDefs) {
			const plugin = buildPanelPlugin(def);
			if (plugin) {
				pluginRegistry.register(plugin);
				registered.push(plugin.id);
			}
		}
		// 组件卸载时清理本会话注册的插件，避免跨会话污染
		return () => {
			for (const id of registered) {
				pluginRegistry.unregister(id);
			}
		};
	}, [features, manifest, localDefs]);

	const activePlugins = useMemo(
		() => pluginRegistry.getActive(features),
		[features, pluginRegistry.version],
	);

	const ctxRef = useRef<PluginContext>(undefined as unknown as PluginContext);
	const prevActiveRef = useRef<PanelPlugin[]>([]);

	const sendMessage = useCallback(
		async (text: string) => {
			let processed = text;
			for (const plugin of activePlugins) {
				if (plugin.hooks?.beforeSend) {
					const result = plugin.hooks.beforeSend(processed, ctxRef.current);
					processed =
						result instanceof Promise ? await result : result;
				}
			}
			const bus = busRef.current;
			streamRef.current.send(processed, {
				onPatientChunk: () => bus.emit("stream:chunk"),
				onPatientDone: () => bus.emit("stream:done"),
				onError: (err) => bus.emit("stream:error", err),
				onExamResult: (examResult) => bus.emit("exam:result", examResult),
				onEmotionChange: (change) => bus.emit("emotion:changed", change),
				onInitiative: (initiative) =>
					bus.emit("initiative:triggered", { content: initiative }),
			});
		},
		[activePlugins],
	);

	const endTraining = useCallback(async () => {
		for (const plugin of activePlugins) {
			plugin.hooks?.onEnd?.("manual", ctxRef.current);
		}
		try {
			await scoreRef.current.end();
		} catch {
			// end() 已更新 UI 为失败状态，继续发出事件以允许 overlay 显示
		}
		busRef.current.emit("training:ended");
	}, [activePlugins]);

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

	ctxRef.current = ctx;

	useEffect(() => {
		const prevActive = prevActiveRef.current;
		prevActiveRef.current = activePlugins;

		const activeIds = new Set(activePlugins.map((p) => p.id));

		for (const plugin of prevActive) {
			if (!activeIds.has(plugin.id)) {
				plugin.hooks?.onDestroy?.();
			}
		}

		const cleanups = cleanupRefs.current;

		for (const [id, cleanup] of cleanups) {
			if (!activeIds.has(id)) {
				if (typeof cleanup === "function") cleanup();
				cleanups.delete(id);
			}
		}

		for (const plugin of activePlugins) {
			if (cleanups.has(plugin.id)) continue;
			if (plugin.hooks?.onInit) {
				const cleanup = plugin.hooks.onInit(ctx);
				cleanups.set(plugin.id, cleanup);
			}
		}
	}, [activePlugins, ctx]);

	const [processedMessages, setProcessedMessages] = useState<ChatMessage[]>(
		[],
	);

	useEffect(() => {
		let cancelled = false;
		(async () => {
			let msgs = [...messages];
			for (const plugin of activePlugins) {
				if (plugin.hooks?.afterReceive) {
					const next: ChatMessage[] = [];
					for (const msg of msgs) {
						const result = plugin.hooks.afterReceive(msg, ctx);
						if (result instanceof Promise) {
							try {
								const resolved = await result;
								if (cancelled) return;
								if (resolved !== null) next.push(resolved);
							} catch {
								next.push(msg);
							}
						} else if (result !== null) {
							next.push(result);
						}
					}
					msgs = next;
				}
			}
			if (!cancelled) setProcessedMessages(msgs);
		})();
		return () => {
			cancelled = true;
		};
	}, [messages, activePlugins, ctx]);

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
			<div className="flex h-screen items-center justify-center">
				<div className="size-8 animate-spin rounded-full border-[3px] border-primary/30 border-t-primary" />
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

	const panelPluginsWrapped = activePlugins.map((p) => ({
		...p,
		component: (props: unknown) => (
			<PluginErrorBoundary pluginName={p.meta.name}>
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
						manifestFeatureFlags={manifest?.feature_flags}
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
						messages={processedMessages}
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
