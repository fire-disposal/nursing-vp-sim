import { useCallback, useEffect, useState } from "react"
import type { MessageBus } from "./mock/bus"
import { emitSceneEvent, type SceneState } from "./scene-types"

const DEFAULT: SceneState = {
  environment: { type: "clinic", time_of_day: "day", equipment: [] },
  patient: { position: "supine", consciousness: "alert", expression: "neutral", visible_symptoms: [] },
  vitals: {},
}

/** Mirror of frontend/src/engine/useSceneBus.ts — same API for sandbox. */
export function useSceneState(bus: MessageBus | null): SceneState {
  const [state, setState] = useState<SceneState>(DEFAULT)

  useEffect(() => {
    if (!bus) return
    return bus.on("scene:state", (patch: Partial<SceneState>) => {
      setState((prev) => deepMerge(prev, patch))
    })
  }, [bus])

  return state
}

function deepMerge(base: SceneState, patch: Partial<SceneState>): SceneState {
  const out = { ...base } as Record<string, unknown>
  for (const [k, v] of Object.entries(patch)) {
    if (v !== null && typeof v === "object" && !Array.isArray(v) && typeof out[k] === "object") {
      out[k] = { ...(out[k] as Record<string, unknown>), ...v }
    } else {
      out[k] = v
    }
  }
  return out as SceneState
}

/** Stable callback that emits `scene:interaction` — scenes don't need bus directly. */
export function useEmitInteraction(bus: MessageBus | null) {
  return useCallback(
    (hotspotId: string, metadata?: Record<string, unknown>) => {
      if (!bus) return
      emitSceneEvent(bus, "scene:interaction", { hotspotId, metadata })
    },
    [bus],
  )
}
