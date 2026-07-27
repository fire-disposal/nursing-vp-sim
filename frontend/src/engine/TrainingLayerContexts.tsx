import { createContext, useContext } from "react";
import type { MessageBus, PatientData } from "./types";
import type { TrainingRecordDetail } from "./TrainingContext";

// ── Static: rarely changes, needed by panels/toolbar ──

export interface TrainingStaticValue {
  bus: MessageBus;
  recordId: string;
  patient: PatientData;
  trainingType: string;
  capabilities: Record<string, boolean>;
  timeLimitMinutes: number;
  recordDetail: TrainingRecordDetail | null;
}

const TrainingStaticCtx = createContext<TrainingStaticValue | null>(null);

export function TrainingStaticProvider({
  value,
  children,
}: {
  value: TrainingStaticValue;
  children: React.ReactNode;
}) {
  return (
    <TrainingStaticCtx.Provider value={value}>
      {children}
    </TrainingStaticCtx.Provider>
  );
}

export function useTrainingStatic(): TrainingStaticValue {
  const ctx = useContext(TrainingStaticCtx);
  if (!ctx) throw new Error("useTrainingStatic must be used within TrainingStaticProvider");
  return ctx;
}

// ── Dynamic: changes every message — chat area only ──

export interface TrainingDynamicValue {
  messages: import("./types").ChatMessage[];
  sending: boolean;
}

const TrainingDynamicCtx = createContext<TrainingDynamicValue>({ messages: [], sending: false });

export function TrainingDynamicProvider({
  value,
  children,
}: {
  value: TrainingDynamicValue;
  children: React.ReactNode;
}) {
  return (
    <TrainingDynamicCtx.Provider value={value}>
      {children}
    </TrainingDynamicCtx.Provider>
  );
}

export function useTrainingDynamic(): TrainingDynamicValue {
  return useContext(TrainingDynamicCtx);
}

// ── UI State: TTS, timer, voice — header/user prefs ──

export interface TrainingUIStateValue {
  ttsAutoPlay: boolean;
  toggleTts: () => void;
  voiceStatus: { provider: string; latencyMs: number } | null;
  remainingSeconds: number | null;
  endTraining: () => Promise<void>;
}

const TrainingUIStateCtx = createContext<TrainingUIStateValue>({
  ttsAutoPlay: true,
  toggleTts: () => {},
  voiceStatus: null,
  remainingSeconds: null,
  endTraining: async () => {},
});

export function TrainingUIStateProvider({
  value,
  children,
}: {
  value: TrainingUIStateValue;
  children: React.ReactNode;
}) {
  return (
    <TrainingUIStateCtx.Provider value={value}>
      {children}
    </TrainingUIStateCtx.Provider>
  );
}

export function useTrainingUIState(): TrainingUIStateValue {
  return useContext(TrainingUIStateCtx);
}
