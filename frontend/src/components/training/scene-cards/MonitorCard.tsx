import { useSceneState } from "@/engine/useSceneBus";
import type { SceneCardProps } from "@/engine/scene-card";
import { PatientMonitor, type MonitorStatus } from "@/components/training/PatientMonitor";
import type { SceneState } from "@/engine/scene-state";

function classify(s: SceneState): MonitorStatus {
  const v = s.vitals || {};
  return {
    hr: !v.hr ? "normal" : v.hr > 100 ? "tachycardia" : v.hr < 55 ? "bradycardia" : "normal",
    spo2: !v.spo2 ? "normal" : v.spo2 < 90 ? "critical" : v.spo2 < 95 ? "low" : "normal",
    bp: !v.bp_sys ? "normal" : v.bp_sys > 160 ? "hypertensive" : v.bp_sys > 130 ? "elevated" : "normal",
    rr: !v.rr ? "normal" : v.rr > 24 ? "tachypnea" : v.rr < 10 ? "bradypnea" : "normal",
    temp: !v.temp ? "normal" : v.temp > 38 ? "fever" : v.temp < 36 ? "hypothermia" : "normal",
    pain: !v.pain ? "none" : v.pain > 7 ? "severe" : v.pain > 4 ? "moderate" : v.pain > 0 ? "mild" : "none",
  }
}

export default function MonitorCard({ bus }: SceneCardProps) {
  const sceneState = useSceneState(bus);
  const status = classify(sceneState);

  return (
    <div style={{ padding: 8 }}>
      <PatientMonitor status={status} />
    </div>
  );
}
