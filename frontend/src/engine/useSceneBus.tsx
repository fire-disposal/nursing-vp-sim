import { createContext, useContext, useEffect, useState } from "react";
import type { SceneState } from "./scene-state";
import type { MessageBus } from "./types";

const DEFAULT_SCENE: SceneState = {
  environment: { type: "clinic", time_of_day: "day", equipment: [] },
  patient: { position: "supine", consciousness: "alert", expression: "neutral", visible_symptoms: [] },
  vitals: {},
};

let _busRef: MessageBus | null = null;
let _sceneState: SceneState = deepClone(DEFAULT_SCENE);
const _subscribers = new Set<() => void>();

function _notify() {
  _subscribers.forEach((fn) => { fn(); });
}

const SceneStateContext = createContext<SceneState>(DEFAULT_SCENE);

export function useSceneState(bus: MessageBus | null): SceneState {
  const [, setTick] = useState(0);

  if (bus !== _busRef) {
    _busRef = bus;
    _sceneState = deepClone(DEFAULT_SCENE);
  }

  useEffect(() => {
    const listener = () => setTick((t) => t + 1);
    _subscribers.add(listener);
    return () => { _subscribers.delete(listener); };
  }, []);

  useEffect(() => {
    if (!bus) return;
    return bus.on("scene:state", (patch: Partial<SceneState>) => {
      _sceneState = deepMerge(_sceneState, patch);
      _notify();
    });
  }, [bus]);

  return _sceneState;
}

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

function deepClone(obj: SceneState): SceneState {
  return JSON.parse(JSON.stringify(obj));
}

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
