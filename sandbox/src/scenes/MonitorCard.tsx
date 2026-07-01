import { useEffect, useState } from "react"
import { createMockBus } from "../mock/bus"
import { playSequence } from "../mock/events"
import type { MessageBus } from "../mock/bus"
import { useSceneState } from "../useSceneBus"
import type { SceneCardProps } from "../scene-types"
import { PatientMonitor } from "../components/PatientMonitor"

export default function MonitorCard(_props: SceneCardProps) {
  const [bus] = useState(() => createMockBus())
  const sceneState = useSceneState(bus)
  const vitals = sceneState.vitals || {}

  useEffect(() => {
    playSequence(bus, [
      { event: "scene:state", args: [{ vitals: { hr: 76, spo2: 98, bp_sys: 120, bp_dia: 80, temp: 36.6, rr: 16, pain: 0 } }], delay: 200 },
      { event: "scene:state", args: [{ vitals: { hr: 112, spo2: 93, bp_sys: 150, bp_dia: 95, temp: 38.4, rr: 26, pain: 6 } }], delay: 4000 },
      { event: "scene:state", args: [{ vitals: { hr: 88, spo2: 97, bp_sys: 130, bp_dia: 85, temp: 37.1, rr: 18, pain: 3 } }], delay: 8000 },
    ])
  }, [])

  return (
    <div style={{ padding: 8 }}>
      <PatientMonitor vitals={vitals} />
    </div>
  )
}
