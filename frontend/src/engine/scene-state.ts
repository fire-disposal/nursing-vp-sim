import type { MessageBus } from "./types";

/** Props every scene component receives — same shape in sandbox & production */
export interface SceneProps {
  bus: MessageBus;
  mode: "sandbox" | "training";
  initialState?: SceneState;
}

/** The ground-truth clinical scene — drives both LLM prompt and visual rendering */
export interface SceneState {
  environment?: {
    type?: "icu" | "ward" | "er" | "clinic" | "home";
    time_of_day?: "morning" | "day" | "night";
    equipment?: string[];
    noise_level?: "quiet" | "moderate" | "loud";
  };
  patient?: {
    position?: "supine" | "sitting" | "semi-recumbent" | "lateral";
    consciousness?: "alert" | "lethargic" | "confused" | "unresponsive";
    visible_symptoms?: string[];
    expression?: string;
    speaking?: boolean;
  };
  vitals?: {
    hr?: number;
    bp_sys?: number;
    bp_dia?: number;
    rr?: number;
    spo2?: number;
    temp?: number;
    pain?: number;
  };
  phase?: string;
  procedure_step?: number;
}

/** Events the scene layer understands */
export interface SceneBusProtocol {
  /** Scene → Training: user clicked / interacted with something (exam, body check, etc.) */
  "scene:interaction": [{ hotspotId: string; metadata?: Record<string, unknown> }];
  /** ← Training → Scene: full or partial scene state update (vitals, position, etc.) */
  "scene:state": [Partial<SceneState>];
}

/** Subscribe to scene‑relevant bus events with correct types */
export function onSceneEvent<K extends keyof SceneBusProtocol>(
  bus: MessageBus,
  event: K,
  handler: (...args: SceneBusProtocol[K]) => void,
): () => void {
  return bus.on(event, handler as (...args: unknown[]) => void);
}

/** Emit a scene event */
export function emitSceneEvent<K extends keyof SceneBusProtocol>(
  bus: MessageBus,
  event: K,
  ...args: SceneBusProtocol[K]
): void {
  bus.emit(event, ...(args as unknown[]));
}
