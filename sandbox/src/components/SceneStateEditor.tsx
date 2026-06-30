import { useCallback } from "react"
import type { MessageBus } from "../mock/bus"
import type { SceneState } from "../scene-types"
import { emitSceneEvent } from "../scene-types"
import { useSceneState } from "../useSceneBus"

const PRESETS: Record<string, Partial<SceneState>> = {
  "vitals normal":  { vitals: { hr: 72, bp_sys: 120, bp_dia: 80, spo2: 98, temp: 36.5 } },
  "vitals alarming": { vitals: { hr: 118, bp_sys: 85, bp_dia: 50, spo2: 91, rr: 26, pain: 7 } },
  "patient anxious": { patient: { expression: "anxious", consciousness: "alert", position: "sitting" } },
  "patient lethargic": { patient: { expression: "flat", consciousness: "lethargic", position: "semi-recumbent" } },
  "icu night":   { environment: { type: "icu", time_of_day: "night", equipment: ["monitor", "ventilator", "iv_pump"] } },
  "ward morning": { environment: { type: "ward", time_of_day: "morning", equipment: ["monitor"] } },
}

export function SceneStateEditor({ bus }: { bus: MessageBus }) {
  const state = useSceneState(bus)

  const apply = useCallback((patch: Partial<SceneState>) => {
    emitSceneEvent(bus, "scene:state", patch)
  }, [bus])

  return (
    <div style={{
      width: 260, background: "#1a1a2e", borderLeft: "1px solid #333",
      display: "flex", flexDirection: "column", fontFamily: "monospace", fontSize: 11, overflow: "auto",
    }}>
      <div style={{ padding: "8px 12px", borderBottom: "1px solid #333", color: "#888", fontWeight: 600 }}>
        SCENE STATE
      </div>

      {/* Current state JSON */}
      <pre style={{ padding: "8px 12px", margin: 0, color: "#aaa", whiteSpace: "pre-wrap", wordBreak: "break-all", maxHeight: 200, overflow: "auto", borderBottom: "1px solid #333", fontSize: 10 }}>
        {JSON.stringify(state, null, 2)}
      </pre>

      {/* Preset buttons */}
      <div style={{ padding: "8px 12px", display: "flex", flexDirection: "column", gap: 4 }}>
        <div style={{ color: "#666", fontWeight: 600, fontSize: 10, marginBottom: 4 }}>PRESETS</div>
        {Object.entries(PRESETS).map(([label, patch]) => (
          <button key={label} onClick={() => apply(patch)}
            style={{
              padding: "4px 8px", background: "#2a2a3e", border: "1px solid #444",
              borderRadius: 4, color: "#ccc", cursor: "pointer", fontSize: 10,
              textAlign: "left", transition: "all 0.1s",
            }}
            onMouseEnter={(e) => { (e.target as HTMLButtonElement).style.background = "#333" }}
            onMouseLeave={(e) => { (e.target as HTMLButtonElement).style.background = "#2a2a3e" }}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  )
}
