// frontend/src/engine/TrainingEngine.tsx
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createMessageBus } from "./MessageBus";
import { PatientProvider, usePatient } from "./PatientProvider";
import { pluginRegistry } from "./PluginRegistry";
import { ScoreManager } from "./ScoreManager";
import { SlotRenderer } from "./SlotRenderer";
import { StreamManager } from "./StreamManager";
import { TTSManager } from "./tts/TTSManager";
import type { ChatMessage, LayoutDef, SlotName, SlotProps, TrainingPlugin } from "./types";
import { useResponsiveLayout } from "./useResponsiveLayout";

const DEFAULT_LAYOUT: LayoutDef = {
  breakpoints: {
    desktop: {
      areas: [
        ["header", "header", "header"],
        ["sidebar", "content", "panel"],
        ["footer", "footer", "panel"],
      ],
      slots: {
        header: { render: "inline" },
        sidebar: { render: "inline", priority: 1 },
        content: { render: "inline" },
        panel: { render: "inline", priority: 2 },
        footer: { render: "inline" },
        overlay: { render: "modal" },
      },
    },
    mobile: {
      areas: [["header"], ["content"], ["footer"]],
      slots: {
        header: { render: "inline" },
        content: { render: "inline" },
        footer: { render: "inline" },
        sidebar: { render: "sheet", priority: 1 },
        panel: { render: "drawer", priority: 2 },
        overlay: { render: "modal" },
      },
    },
  },
  sidebarBehavior: "fixed",
  panelBehavior: "inline",
};

interface TrainingEngineProps {
  recordId: string;
  scenarioConfig?: { features?: Record<string, boolean>; layout?: LayoutDef; plugins?: string[] };
  plugins: TrainingPlugin[];
}

function TrainingEngineInner({ recordId, scenarioConfig, plugins }: TrainingEngineProps) {
  const { patient, loading } = usePatient();
  const recordNum = Number(recordId);

  const busRef = useRef(createMessageBus());
  const streamRef = useRef(new StreamManager(recordNum));
  const scoreRef = useRef(new ScoreManager(recordNum, busRef.current));
  const ttsRef = useRef(new TTSManager({ autoPlay: true }));

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

  const [_score, setScore] = useState(scoreRef.current.score);
  const [_progress, setProgress] = useState(scoreRef.current.progress);

  useEffect(() => {
    scoreRef.current.setRecordId(recordNum);
    const unsub = scoreRef.current.subscribe(() => {
      setScore(scoreRef.current.score);
      setProgress(scoreRef.current.progress);
    });
    return unsub;
  }, [recordNum]);

  const [registryVersion, setRegistryVersion] = useState(0);

  useEffect(() => {
    pluginRegistry.setFeatureFlags(scenarioConfig?.features ?? {});
    for (const p of plugins) pluginRegistry.register(p);
    setRegistryVersion(pluginRegistry.version);
  }, []);

  useEffect(() => {
    const unsub = busRef.current.on("plugins:updated", () => {
      setRegistryVersion(pluginRegistry.version);
    });
    return unsub;
  }, []);

  const activePlugins = useMemo(() => pluginRegistry.getActive(), [registryVersion]);

  const layout = scenarioConfig?.layout ?? DEFAULT_LAYOUT;
  const grid = useResponsiveLayout(layout);

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

  const slotProps: SlotProps = useMemo(
    () => ({
      ctx: {
        recordId,
        bus: busRef.current,
        patient: patient!,
        messages,
        loading: sending,
        tts: {
          isAutoPlay: ttsAutoPlay,
          setAutoPlay: setTtsAutoPlay,
        },
        sendMessage,
        endTraining,
      },
      features: scenarioConfig?.features ?? {},
      currentPhase: "history_taking",
      phaseCount: 1,
      advancePhase: () => {},
    }),
    [recordId, patient, messages, sending, sendMessage, endTraining, scenarioConfig?.features],
  );

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

  const gridTemplateAreas = grid.areas.map((row) => `"${row.join(" ")}"`).join(" ");

  return (
    <div className="training-grid h-screen gap-2 p-2" style={{ display: "grid", gridTemplateAreas }}>
      {(["header", "sidebar", "content", "panel", "footer", "overlay", "input-toolbar", "sidebar-tray"] as SlotName[]).map((name) => {
        const def = grid.slots[name as SlotName];
        if (!def) return null;
        return <SlotRenderer key={name} name={name} plugins={activePlugins} definition={def} slotProps={slotProps} />;
      })}
    </div>
  );
}

export function TrainingEngine(props: TrainingEngineProps) {
  return (
    <PatientProvider recordId={props.recordId}>
      <TrainingEngineInner {...props} />
    </PatientProvider>
  );
}
