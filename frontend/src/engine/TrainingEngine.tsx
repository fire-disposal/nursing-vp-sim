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
  panelPlugins: PanelPlugin[];
}

function TrainingEngineContent({ recordId, panelPlugins }: TrainingEngineProps) {
  const { patient, loading, features: initialFeatures, fromAssignment } = usePatient();
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
  const [features, setFeatures] = useState<Record<string, boolean>>(initialFeatures);

  useEffect(() => {
    setFeatures(initialFeatures);
  }, [initialFeatures]);

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
    return () => scoreRef.current.dispose();
  }, [recordNum]);

  useEffect(() => {
    pluginRegistry.setFeatureFlags(features);
    for (const p of panelPlugins) pluginRegistry.register(p);
  }, [features, panelPlugins]);

  const activePlugins = useMemo(() => pluginRegistry.getActive(features), [features]);

  const sendMessage = useCallback((text: string) => {
    const bus = busRef.current;
    streamRef.current.send(text, {
      onPatientChunk: () => bus.emit("stream:chunk"),
      onPatientDone: () => bus.emit("stream:done"),
      onError: (err) => bus.emit("stream:error", err),
      onExamResult: (examResult) => bus.emit("exam:result", examResult),
      onEmotionChange: (change) => bus.emit("emotion:changed", change),
      onInitiative: (initiative) => bus.emit("initiative:triggered", { content: initiative }),
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
    const activeIds = new Set(activePlugins.map((p) => p.id));

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

  const [processedMessages, setProcessedMessages] = useState<ChatMessage[]>([]);

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
    return busRef.current.on("emotion:changed", (data: { state: string }) => {
      setEmotion(data.state as EmotionState);
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
            messageCount={processedMessages.length}
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
          />
        </div>
        <div style={{ gridArea: "content", overflow: "hidden" }}>
          <ChatArea messages={processedMessages} patient={patient} sending={sending} onSend={sendMessage} bus={busRef.current} />
        </div>
        <div style={{ gridArea: "panel", overflow: "hidden" }}>
          <PanelHost ctx={ctx} features={features} plugins={activePlugins} />
        </div>
      </div>
      <QuestionnaireOverlay recordId={recordId} bus={busRef.current} features={features} />
      <ScoringOverlay bus={busRef.current} />
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
