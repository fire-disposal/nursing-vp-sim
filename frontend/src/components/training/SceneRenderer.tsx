import { lazy, Suspense } from "react";
import type { SceneState } from "@/engine/scene-state";
import { useTrainingContext } from "@/engine/TrainingContext";
import { useSceneState } from "@/engine/useSceneBus";

const ExamBodyScene = lazy(() => import("@/components/training/body-exam/ExamBodyScene"));

/**
 * Renders active scenes based on enabled capabilities.
 * Each capability (exam_scene, scene_3d, …) maps to a scene component.
 *
 * Scenes receive the real MessageBus from TrainingContext,
 * matching the sandbox's SceneProps interface exactly.
 */
export function SceneRenderer() {
  const { bus, features } = useTrainingContext();
  const sceneState = useSceneState(bus);

  return (
    <>
      {features.exam_scene && (
        <Suspense fallback={null}>
          <ExamBodyScene bus={bus} mode="training" />
        </Suspense>
      )}
      {features.scene_3d && !features.exam_scene && (
        <SceneStateOverlay state={sceneState} />
      )}
    </>
  );
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
