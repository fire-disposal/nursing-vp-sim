import { useCallback, useRef, useState } from "react"
import type { HotspotDef } from "../components/Hotspot"
import { Hotspot } from "../components/Hotspot"
import { emitSceneEvent, type SceneProps, type SceneState } from "../scene-types"

const HOTSPOTS: HotspotDef[] = [
  { id: "bed",     label: "病床",   x: 12, y: 30, w: 40, h: 38, color: "#5b7db5" },
  { id: "patient", label: "患者",   x: 24, y: 36, w: 14, h: 22, color: "#8ab0d6" },
  { id: "monitor", label: "监护仪", x: 56, y: 28, w: 12, h: 16, color: "#4a9e6f" },
  { id: "iv",      label: "输液架", x: 46, y: 20, w:  6, h: 40, color: "#b5a05b" },
  { id: "table",   label: "床头柜", x: 10, y: 64, w: 16, h: 12, color: "#a07a5b" },
  { id: "acc",     label: "设备柜", x: 72, y: 52, w: 16, h: 24, color: "#6b7a8a" },
]

const STEPS = [
  { hotspot: "patient", label: "观察面色", state: { patient: { expression: "pale", consciousness: "alert" as const } } },
  { hotspot: "bed",     label: "调整体位", state: { patient: { position: "semi-recumbent" as const } } },
  { hotspot: "monitor", label: "查看监护", state: { vitals: { hr: 98, bp_sys: 130, bp_dia: 85, spo2: 96 } } },
  { hotspot: "iv",      label: "检查输液", state: { vitals: { hr: 88 } } },
]

export default function Demo2D({ bus, mode }: SceneProps) {
  const [step, setStep] = useState(0)
  const [log, setLog] = useState<string[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const stateRef = useRef<SceneState>({})

  const handleInteract = useCallback((id: string) => {
    setActiveId(id)
    setTimeout(() => setActiveId(null), 600)

    const label = HOTSPOTS.find((h) => h.id === id)?.label ?? id
    setLog((p) => [`${new Date().toLocaleTimeString()} · ${label}`, ...p].slice(0, 10))

    emitSceneEvent(bus, "scene:interaction", { hotspotId: id })

    const s = STEPS.findIndex((x) => x.hotspot === id)
    if (s === step && s < STEPS.length) {
      setStep((p) => Math.min(p + 1, STEPS.length))
      stateRef.current = { ...stateRef.current, ...STEPS[s].state }
      emitSceneEvent(bus, "scene:state", stateRef.current)
    }
  }, [step, bus])

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 420, fontFamily: "system-ui" }}>
      {/* Room area */}
      <div style={{ flex: 1, position: "relative", background: "#2a2a3a", minHeight: 280, overflow: "hidden" }}>
        <div style={{
          position: "absolute", inset: "6%", background: "#3a3a4e", borderRadius: 12,
          border: "2px solid #4a4a5e",
        }}>
          <div style={{ position: "absolute", bottom: "28%", left: 0, right: 0, height: 2, background: "#4a4a5e" }} />
          {HOTSPOTS.map((h) => (
            <Hotspot key={h.id} def={h} highlight={activeId === h.id} onInteract={handleInteract} />
          ))}
        </div>

        {/* Step indicator */}
        {mode === "sandbox" && (
          <div style={{
            position: "absolute", bottom: "2%", left: "50%", transform: "translateX(-50%)",
            display: "flex", gap: 4, background: "#1a1a2ecc", padding: "4px 10px",
            borderRadius: 14, backdropFilter: "blur(4px)", whiteSpace: "nowrap",
          }}>
            {STEPS.map((s, i) => (
              <div key={s.label} style={{ display: "flex", alignItems: "center", gap: 3, color: i < step ? "#4fc3f7" : i === step ? "#fff" : "#555", fontSize: 10 }}>
                <span style={{
                  width: 16, height: 16, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 9, fontWeight: 700, background: i < step ? "#4fc3f7" : i === step ? "#4fc3f733" : "#333",
                  color: i < step ? "#111" : i === step ? "#4fc3f7" : "#555",
                }}>{i < step ? "✓" : i + 1}</span>
                <span>{s.label}</span>
                {i < STEPS.length - 1 && <span style={{ color: "#555", fontSize: 9 }}>→</span>}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Log strip — compact, below the room */}
      <div style={{
        height: 36, background: "#1a1a2e", borderTop: "1px solid #333",
        display: "flex", alignItems: "center", gap: 4, padding: "0 10px", overflow: "auto",
      }}>
        <span style={{ color: "#666", fontSize: 10, fontWeight: 600, whiteSpace: "nowrap", marginRight: 4 }}>
          {new Set(log).size > 0 ? "" : "🔍 "}LOG
        </span>
        {log.length === 0 && (
          <span style={{ color: "#555", fontSize: 11 }}>Click a hotspot to interact</span>
        )}
        {log.map((entry, i) => (
          <span key={i} style={{
            padding: "2px 8px", background: "#2a2a3e", borderRadius: 4,
            color: "#aaa", fontSize: 10, whiteSpace: "nowrap",
          }}>{entry}</span>
        ))}
      </div>
    </div>
  )
}
