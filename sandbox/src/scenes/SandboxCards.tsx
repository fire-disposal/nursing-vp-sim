import { createMockBus } from "../mock/bus"
import type { MessageBus } from "../mock/bus"
import { DEFAULT_EMOTION_SEQUENCE, playSequence } from "../mock/events"
import PatientInfoCard from "./PatientInfoCard"
import InquiryCard from "./InquiryCard"
import MonitorCard from "./MonitorCard"
import NotesCard from "./NotesCard"

const CARDS = [
  { id: "patient-info", label: "患者信息", Component: PatientInfoCard },
  { id: "inquiry", label: "问诊清单", Component: InquiryCard },
  { id: "monitor", label: "监护仪", Component: MonitorCard },
  { id: "notes", label: "笔记", Component: NotesCard },
]

export default function SandboxCards() {
  const [bus] = useState(() => createMockBus())
  const recordId = "sandbox-demo"

  useEffect(() => {
    playSequence(bus, [
      ...DEFAULT_EMOTION_SEQUENCE,
      { event: "scene:state", args: [{ vitals: { hr: 88, spo2: 97, bp_sys: 125, bp_dia: 82, temp: 36.8, rr: 18, pain: 0 } }], delay: 1000 },
      { event: "scene:state", args: [{ vitals: { hr: 112, spo2: 93, bp_sys: 145, bp_dia: 95, rr: 26, temp: 38.5, pain: 6 } }], delay: 5000 },
    ])
  }, [])

  const cardProps = { bus: bus as MessageBus, mode: "sandbox" as const, recordId }

  return (
    <div style={{ display: "flex", height: "100%", background: "#1a1a2a" }}>
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "#555", fontFamily: "system-ui", fontSize: 14 }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 24, marginBottom: 8 }}>🩺</div>
          <div>场景卡片预览</div>
          <div style={{ color: "#444", fontSize: 12, marginTop: 4 }}>右侧显示各场景卡片</div>
        </div>
      </div>
      <div style={{ width: 280, borderLeft: "1px solid #333", background: "#12121e", overflow: "auto", display: "flex", flexDirection: "column" }}>
        {CARDS.map(({ id, label, Component }) => (
          <section key={id} style={{ borderBottom: "1px solid #222" }}>
            <div style={{ padding: "6px 12px 2px", fontSize: 10, color: "#666", fontWeight: 600, textTransform: "uppercase", letterSpacing: 1 }}>
              {label}
            </div>
            <Component {...cardProps} />
          </section>
        ))}
      </div>
    </div>
  )
}

import { useEffect, useState } from "react"
