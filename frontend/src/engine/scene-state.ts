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

/** Emit a scene state update */
export function emitSceneEvent(bus: MessageBus, event: string, ...args: unknown[]): void {
  bus.emit(event, ...args);
}
