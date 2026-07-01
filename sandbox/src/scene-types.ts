import type { ComponentType } from "react"
import type { MessageBus } from "./mock/bus"

// ── Ground-truth clinical state ──
export interface SceneState {
  environment?: {
    type?: "icu" | "ward" | "er" | "clinic" | "home"
    time_of_day?: "morning" | "day" | "night"
    equipment?: string[]
    noise_level?: "quiet" | "moderate" | "loud"
  }
  patient?: {
    position?: "supine" | "sitting" | "semi-recumbent" | "lateral"
    consciousness?: "alert" | "lethargic" | "confused" | "unresponsive"
    visible_symptoms?: string[]
    expression?: string
    speaking?: boolean
  }
  vitals?: {
    hr?: number; bp_sys?: number; bp_dia?: number
    rr?: number; spo2?: number; temp?: number; pain?: number
  }
  phase?: string
  procedure_step?: number
}

// ── Props every scene receives (identical in sandbox & main app) ──
export interface SceneProps {
  bus: MessageBus
  mode: "sandbox" | "training"
  initialState?: SceneState
}

// ── Bus protocol: well‑typed scene ↔ host events ──
export interface SceneBusProtocol {
  "scene:interaction": [{ hotspotId: string; metadata?: Record<string, unknown> }]
  "scene:observation": [{ observation: string; confidence?: number }]
  "scene:completed":  [{ procedureId: string }]
  "scene:state":      [Partial<SceneState>]
}

/** Subscribe to a scene event with correct payload type. */
export function onSceneEvent<K extends keyof SceneBusProtocol>(
  bus: MessageBus,
  event: K,
  handler: (...args: SceneBusProtocol[K]) => void,
): () => void {
  return bus.on(event, handler as (...args: unknown[]) => void)
}

// ── Scene card protocol (mirrors engine/scene-card.ts) ──
export interface SceneCardProps extends SceneProps {
  recordId: string
}

export interface SceneCard {
  id: string
  component: ComponentType<SceneCardProps>
  featureFlag?: string
  priority: number
}

/** Emit a scene event. */
export function emitSceneEvent<K extends keyof SceneBusProtocol>(
  bus: MessageBus,
  event: K,
  ...args: SceneBusProtocol[K]
): void {
  bus.emit(event, ...(args as unknown[]))
}
