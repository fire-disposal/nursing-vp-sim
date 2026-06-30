import { useTrainingContext } from "@/engine/TrainingContext";
import { useSceneState } from "@/engine/useSceneBus";
import type { SceneProps, SceneState } from "@/engine/scene-state";

/**
 * Mounted inside a training scene when a 3D/2D scene component is
 * registered.  Bridges the real MessageBus to the scene's props.
 *
 * @example
 * ```tsx
 * <SceneRenderer>
 *   <MyScene bus={bus} mode="training" />
 * </SceneRenderer>
 * ```
 */
export function SceneRenderer({ children }: { children?: React.ReactNode }) {
  const { bus, features } = useTrainingContext();
  const sceneState = useSceneState(bus);

  if (!features.scene_3d) return null;

  if (children) return <>{children}</>;

  // Fallback: render a text summary of the current scene state
  return <SceneStateOverlay state={sceneState} />;
}

// ── minimal debug overlay ──
function SceneStateOverlay({ state }: { state: SceneState }) {
  return (
    <div
      style={{
        position: "fixed",
        bottom: 60,
        left: 12,
        zIndex: 50,
        background: "rgba(0,0,0,0.65)",
        color: "#aaa",
        padding: "8px 12px",
        borderRadius: 8,
        fontSize: 11,
        fontFamily: "monospace",
        lineHeight: 1.5,
        pointerEvents: "none",
        maxWidth: 280,
      }}
    >
      <div style={{ color: "#4fc3f7", fontWeight: 600, marginBottom: 4 }}>SCENE</div>
      <div>{state.environment?.type ?? "—"} · {state.patient?.position ?? "—"}</div>
      <div>
        {state.vitals?.hr ? `HR ${state.vitals.hr}` : ""}
        {state.vitals?.spo2 ? ` · SpO₂ ${state.vitals.spo2}%` : ""}
        {state.vitals?.bp_sys ? ` · BP ${state.vitals.bp_sys}/${state.vitals.bp_dia}` : ""}
      </div>
      <div>{state.patient?.consciousness} · {state.patient?.expression}</div>
    </div>
  );
}
