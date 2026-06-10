import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChatArea } from "@/components/training/ChatArea";
import { PanelHost } from "@/components/training/PanelHost";
import { TrainingHeader } from "@/components/training/TrainingHeader";
import { QuestionnaireOverlay } from "@/plugins/questionnaire/QuestionnaireOverlay";
import { ScoreCard } from "@/plugins/scoring-display/ScoreCard";
import { ScoringOverlay } from "@/plugins/scoring-display/ScoringOverlay";
import { createMessageBus } from "./MessageBus";
import { PatientProvider, usePatient } from "./PatientProvider";
import type { EmotionState } from "./PluginContext";
import { EmotionProvider, PortraitProvider, useEmotion, usePortrait } from "./PluginContext";
import { pluginRegistry } from "./PluginRegistry";
import { ScoreManager } from "./ScoreManager";
import { StreamManager } from "./StreamManager";
import { TTSManager } from "./tts/TTSManager";
import type { ChatMessage, PanelPlugin, PluginContext } from "./types";

interface TrainingEngineProps {
  recordId: string;
  features: Record<string, boolean>;
  panelPlugins: PanelPlugin[];
}

function TrainingEngineInner({ recordId, features, panelPlugins }: TrainingEngineProps) {
  const { patient, loading } = usePatient();
  const recordNum = Number(recordId);

  const busRef = useRef(createMessageBus());
  const streamRef = useRef(new StreamManager(recordNum));
  const scoreRef = useRef(new ScoreManager(recordNum, busRef.current));
  const ttsRef = useRef(new TTSManager({ autoPlay: true }));
  const cleanupRefs = useRef(new Map<string, (() => void) | void>());

  const { setEmotion } = useEmotion();
  const { setPortraitUrl } = usePortrait();

  useEffect(() => {
    ttsRef.current.attach(busRef.current);
    return () => ttsRef.current.detach();
  }, []);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sending, setSending] = useState(false);
  const [ttsAutoPlay, setTtsAutoPlay] = useState(true);

  useEffect(() => {
    streamRef.current.setRecordId(recordNum);
    const unsub = streamRef.current.subscribe(() => setMessages([...streamRef.current.getMessages()]));
    const unsubLoading = streamRef.current.onLoadingChange(setSending);
    return () => {
      unsub();
      unsubLoading();
    };
  }, [recordNum]);

  useEffect(() => {
    scoreRef.current.setRecordId(recordNum);
  }, [recordNum]);

  const [_registryVer, setRegistryVer] = useState(0);

  useEffect(() => {
    pluginRegistry.setFeatureFlags(features);
    for (const p of panelPlugins) pluginRegistry.register(p);
    setRegistryVer(pluginRegistry.version);
  }, []);

  useEffect(() => {
    const unsub = busRef.current.on("plugins:updated", () => setRegistryVer(pluginRegistry.version));
    return unsub;
  }, []);

  const activePlugins = useMemo(() => pluginRegistry.getActive(features), [features, _registryVer]);

  const sendMessage = useCallback((text: string) => {
    streamRef.current.send(text, {
      onPatientChunk: () => busRef.current.emit("stream:chunk"),
      onPatientDone: () => busRef.current.emit("stream:done"),
      onError: (err) => busRef.current.emit("stream:error", err),
    });
  }, []);

  const endTraining = useCallback(async () => {
    await scoreRef.current.end();
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
    [recordId, patient, messages, sending, ttsAutoPlay, sendMessage, endTraining],
  );

  useEffect(() => {
    const cleanups = cleanupRefs.current;
    for (const plugin of activePlugins) {
      if (cleanups.has(plugin.id)) continue;
      if (plugin.hooks?.onInit) {
        const cleanup = plugin.hooks.onInit(ctx);
        cleanups.set(plugin.id, cleanup);
      }
    }
  }, [activePlugins, ctx]);

  const processedMessages = useMemo(() => {
    let msgs = [...messages];
    for (const plugin of activePlugins) {
      if (plugin.hooks?.afterReceive) {
        const next: ChatMessage[] = [];
        for (const msg of msgs) {
          const result = plugin.hooks.afterReceive(msg, ctx);
          if (result instanceof Promise) {
            // Async hooks handled via side effects (bus events)
            next.push(msg);
          } else if (result !== null) {
            next.push(result);
          }
        }
        msgs = next;
      }
    }
    return msgs;
  }, [messages, activePlugins, ctx]);

  useEffect(() => {
    return busRef.current.on("emotion:changed", (data: { emotion: EmotionState }) => {
      setEmotion(data.emotion);
    });
  }, [setEmotion]);

  useEffect(() => {
    return busRef.current.on("portrait:changed", (data: { url: string }) => {
      setPortraitUrl(data.url);
    });
  }, [setPortraitUrl]);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="size-8 animate-spin rounded-full border-[3px] border-primary/30 border-t-primary" />
      </div>
    );
  }

  if (!patient) {
    return <div className="flex h-screen items-center justify-center text-muted-foreground">患者信息加载失败</div>;
  }

  return (
    <EmotionProvider>
      <PortraitProvider>
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
              patient={patient}
              messages={processedMessages}
              ttsAutoPlay={ttsAutoPlay}
              onTtsToggle={() => setTtsAutoPlay((v) => !v)}
              onEnd={endTraining}
              sending={sending}
            />
          </div>
          <div style={{ gridArea: "content", overflow: "hidden" }}>
            <ChatArea messages={processedMessages} patient={patient} sending={sending} onSend={sendMessage} bus={busRef.current} />
          </div>
          <div style={{ gridArea: "panel" }}>
            <PanelHost ctx={ctx} features={features} plugins={activePlugins} />
          </div>
        </div>
        <QuestionnaireOverlay ctx={ctx} features={features} currentPhase="history_taking" phaseCount={1} advancePhase={() => {}} />
        <ScoringOverlay ctx={ctx} features={features} currentPhase="history_taking" phaseCount={1} advancePhase={() => {}} />
        <ScoreCard ctx={ctx} features={features} currentPhase="history_taking" phaseCount={1} advancePhase={() => {}} />
      </PortraitProvider>
    </EmotionProvider>
  );
}

export function TrainingEngine(props: TrainingEngineProps) {
  return (
    <PatientProvider recordId={props.recordId}>
      <TrainingEngineInner {...props} />
    </PatientProvider>
  );
}
