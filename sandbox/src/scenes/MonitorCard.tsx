import { useState } from "react"
import { createMockBus } from "../mock/bus"
import { playSequence } from "../mock/events"
import type { MessageBus } from "../mock/bus"
import { PatientMonitor, type MonitorStatus } from "../components/PatientMonitor"
import type { SceneCardProps } from "../scene-types"

export default function MonitorCard(_props: SceneCardProps) {
  const [status, setStatus] = useState<MonitorStatus>({
    hr: "normal", spo2: "normal", bp: "normal",
    rr: "normal", temp: "normal", pain: "none",
  })

  // Cycle through states on click
  const cycle = () => {
    const states: MonitorStatus[] = [
      { hr: "normal", spo2: "normal", bp: "normal", rr: "normal", temp: "normal", pain: "none" },
      { hr: "tachycardia", spo2: "low", bp: "elevated", rr: "tachypnea", temp: "fever", pain: "moderate" },
      { hr: "bradycardia", spo2: "critical", bp: "hypertensive", rr: "bradypnea", temp: "hypothermia", pain: "severe" },
    ]
    const next = (states.findIndex((s) => s.hr === status.hr) + 1) % states.length
    setStatus(states[next])
  }

  return (
    <div style={{ padding: 8, cursor: "pointer" }} onClick={cycle}>
      <PatientMonitor status={status} patientName="SANDBOX" />
      <div style={{ fontSize: 9, color: "#555", textAlign: "center", marginTop: 4 }}>Click to cycle states</div>
    </div>
  )
}
