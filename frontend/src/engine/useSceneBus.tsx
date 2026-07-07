import { createContext, useContext, useEffect, useRef, useState } from "react";
import type { SceneState } from "./scene-state";
import type { MessageBus } from "./types";

const DEFAULT_SCENE: SceneState = {
  environment: { type: "clinic", time_of_day: "day", equipment: [] },
  patient: { position: "supine", consciousness: "alert", expression: "neutral", visible_symptoms: [] },
  vitals: {},
};

const SceneStateContext = createContext<SceneState>(DEFAULT_SCENE);

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

/**
 * Provider that lifts scene state above individual cards so it
 * persists across card mount/unmount (MonitorCard vitals don't reset).
 */
export function SceneStateProvider({
  bus,
  children,
}: {
  bus: MessageBus | null;
  children: React.ReactNode;
}) {
  const sceneState = useSceneState(bus);
  return (
    <SceneStateContext.Provider value={sceneState}>
      {children}
    </SceneStateContext.Provider>
  );
}

export function useSceneStateValue(): SceneState {
  return useContext(SceneStateContext);
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
