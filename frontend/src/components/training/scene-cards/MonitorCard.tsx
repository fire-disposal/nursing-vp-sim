import { useSceneState } from "@/engine/useSceneBus";
import type { SceneCardProps } from "@/engine/scene-card";
import { PatientMonitor } from "@/components/training/PatientMonitor";

export default function MonitorCard({ bus }: SceneCardProps) {
  const sceneState = useSceneState(bus);
  const vitals = sceneState.vitals || {};

  return (
    <div className="p-3">
      <PatientMonitor vitals={vitals} />
    </div>
  );
}
