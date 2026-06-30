import { useCallback, useEffect, useRef, useState } from "react";
import type { MessageBus } from "./types";
import {
  emitSceneEvent,
  type SceneState,
} from "./scene-state";

const DEFAULT_SCENE: SceneState = {
  environment: { type: "clinic", time_of_day: "day", equipment: [] },
  patient: { position: "supine", consciousness: "alert", expression: "neutral", visible_symptoms: [] },
  vitals: {},
};

/**
 * Keeps a local SceneState mirror that is patched every time
 * the backend broadcasts `scene:state` over the MessageBus.
 *
 * Scenes use this hook to drive their visual rendering.
 */
export function useSceneState(bus: MessageBus | null): SceneState {
  const [state, setState] = useState<SceneState>(DEFAULT_SCENE);

  useEffect(() => {
    if (!bus) return;
    return bus.on("scene:state", (patch: Partial<SceneState>) => {
      setState((prev) => deepMerge(prev, patch));
    });
  }, [bus]);

  return state;
}

/** Shallow‑merge SceneState patches (2 levels deep). */
function deepMerge(base: SceneState, patch: Partial<SceneState>): SceneState {
  const out = { ...base } as Record<string, unknown>;
  for (const [key, val] of Object.entries(patch)) {
    if (val !== null && typeof val === "object" && !Array.isArray(val) && typeof out[key] === "object") {
      out[key] = { ...(out[key] as Record<string, unknown>), ...val };
    } else {
      out[key] = val;
    }
  }
  return out as SceneState;
}

/**
 * Returns a stable `emitInteraction` callback so scenes can
 * fire `scene:interaction` without importing bus directly.
 */
export function useEmitInteraction(bus: MessageBus | null) {
  return useCallback(
    (hotspotId: string, metadata?: Record<string, unknown>) => {
      if (!bus) return;
      emitSceneEvent(bus, "scene:interaction", { hotspotId, metadata });
    },
    [bus],
  );
}
