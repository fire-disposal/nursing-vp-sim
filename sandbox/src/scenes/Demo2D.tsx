import { useCallback, useRef, useState } from "react"
import type { HotspotDef } from "../components/Hotspot"
import { Hotspot } from "../components/Hotspot"
import { InteractionLog, type LogEntry } from "../components/InteractionLog"
import type { SceneProps, SceneState } from "../scene-types"

const HOTSPOTS: HotspotDef[] = [
  { id: "bed",     label: "病床",   x: 12, y: 30, w: 40, h: 38, color: "#5b7db5" },
  { id: "patient", label: "患者",   x: 24, y: 36, w: 14, h: 22, color: "#8ab0d6" },
  { id: "monitor", label: "监护仪", x: 56, y: 28, w: 12, h: 16, color: "#4a9e6f" },
  { id: "iv",      label: "输液架", x: 46, y: 20, w:  6, h: 40, color: "#b5a05b" },
  { id: "table",   label: "床头柜", x: 10, y: 64, w: 16, h: 12, color: "#a07a5b" },
  { id: "door",    label: "门",     x: 84, y:  4, w: 10, h: 28, color: "#6b7a8a" },
]

const STEPS = [
  { hotspot: "patient", label: "观察患者面色", state: { patient: { expression: "pale", consciousness: "alert" as const } } },
  { hotspot: "bed",     label: "调整患者体位", state: { patient: { position: "semi-recumbent" as const } } },
  { hotspot: "monitor", label: "查看监护仪",   state: { vitals: { hr: 98, bp_sys: 130, bp_dia: 85, spo2: 96 } } },
  { hotspot: "iv",      label: "检查输液",     state: { vitals: { hr: 88 } } },
]

function fmtTime() {
  const d = new Date()
  return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}:${d.getSeconds().toString().padStart(2, "0")}`
}

export default function Demo2D({ bus, mode }: SceneProps) {
  const [step, setStep] = useState(0)
  const [log, setLog] = useState<LogEntry[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const stateRef = useRef<SceneState>({})

  const handleInteract = useCallback((id: string) => {
    setActiveId(id)
    setTimeout(() => setActiveId(null), 600)

    const entry: LogEntry = { ts: fmtTime(), text: `点击: ${HOTSPOTS.find((h) => h.id === id)?.label ?? id}` }
    setLog((p) => [entry, ...p].slice(0, 20))
    bus.emit("scene:interaction", { hotspotId: id })

    const s = STEPS.findIndex((x) => x.hotspot === id)
    if (s === step && s < STEPS.length) {
      setStep((p) => Math.min(p + 1, STEPS.length))
      setLog((p) => [{ ts: "", text: `步骤 ${s + 1}: ${STEPS[s].label}`, done: true }, ...p].slice(0, 20))
      stateRef.current = { ...stateRef.current, ...STEPS[s].state }
      bus.emit("scene:state", stateRef.current)
    }
  }, [step, bus])

  return (
    <div style={{ display: "flex", height: "100%", fontFamily: "system-ui" }}>
      {/* Room */}
      <div style={{ flex: 1, position: "relative", background: "#2a2a3a", overflow: "hidden" }}>
        <div style={{
          position: "absolute", inset: "8%", background: "#3a3a4e", borderRadius: 12,
          border: "2px solid #4a4a5e", overflow: "hidden",
        }}>
          <div style={{ position: "absolute", bottom: "26%", left: 0, right: 0, height: 2, background: "#4a4a5e" }} />
          {HOTSPOTS.map((h) => (
            <Hotspot key={h.id} def={h} highlight={activeId === h.id} onInteract={handleInteract} />
          ))}
        </div>

        {/* Step indicator */}
        {mode === "sandbox" && (
          <div style={{
            position: "absolute", bottom: 12, left: "50%", transform: "translateX(-50%)",
            display: "flex", gap: 8, background: "#1a1a2ecc", padding: "8px 16px",
            borderRadius: 20, backdropFilter: "blur(4px)",
          }}>
            {STEPS.map((s, i) => (
              <div key={s.label} style={{ display: "flex", alignItems: "center", gap: 6, color: i < step ? "#4fc3f7" : i === step ? "#fff" : "#555", fontSize: 12 }}>
                <span style={{
                  width: 20, height: 20, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 11, fontWeight: 700, background: i < step ? "#4fc3f7" : i === step ? "#4fc3f733" : "#333",
                  color: i < step ? "#111" : i === step ? "#4fc3f7" : "#555",
                }}>{i < step ? "✓" : i + 1}</span>
                {s.label}
              </div>
            ))}
          </div>
        )}
      </div>

      <InteractionLog entries={log} />
    </div>
  )
}
