import { useSceneState } from "../useSceneBus"
import type { SceneMeta, SceneProps } from "../scene-types"
import { PatientMonitor, type MonitorStatus } from "../components/PatientMonitor"

function classify(vitals: Record<string, number | undefined>): MonitorStatus {
  return {
    hr: !vitals.hr ? "normal" : vitals.hr > 100 ? "tachycardia" : vitals.hr < 55 ? "bradycardia" : "normal",
    spo2: !vitals.spo2 ? "normal" : vitals.spo2 < 90 ? "critical" : vitals.spo2 < 95 ? "low" : "normal",
    bp: !vitals.bp_sys ? "normal" : vitals.bp_sys > 160 ? "hypertensive" : vitals.bp_sys > 130 ? "elevated" : "normal",
    rr: !vitals.rr ? "normal" : vitals.rr > 24 ? "tachypnea" : vitals.rr < 10 ? "bradypnea" : "normal",
    temp: !vitals.temp ? "normal" : vitals.temp > 38 ? "fever" : vitals.temp < 36 ? "hypothermia" : "normal",
    pain: !vitals.pain ? "none" : vitals.pain > 7 ? "severe" : vitals.pain > 4 ? "moderate" : vitals.pain > 0 ? "mild" : "none",
  }
}

export default function MonitorCard({ bus }: SceneProps) {
  const sceneState = useSceneState(bus)
  const status = classify(sceneState.vitals || {})

  return (
    <div style={{ padding: 8 }}>
      <PatientMonitor status={status} patientName="SANDBOX" />
    </div>
  )
}
export const sceneMeta: SceneMeta = {
  id: "card-monitor", name: "卡片: 监护仪", description: "监护仪场景卡片", icon: "💓",
  size: { w: 340, h: 280 },
}
