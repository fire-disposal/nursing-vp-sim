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

export function SceneStateEditor({ bus, dark }: { bus: MessageBus; dark: boolean }) {
  const state = useSceneState(bus)

  const apply = useCallback(
    (patch: Partial<SceneState>) => {
      emitSceneEvent(bus, "scene:state", patch)
    },
    [bus],
  )

  const c = (light: string, darkC: string) => (dark ? darkC : light)

  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        fontFamily: "monospace",
        fontSize: 11,
        overflow: "auto",
      }}
    >
      {/* Current state JSON */}
      <pre
        style={{
          padding: "8px 12px",
          margin: 0,
          color: dark ? "#aaa" : "#666",
          whiteSpace: "pre-wrap",
          wordBreak: "break-all",
          maxHeight: 200,
          overflow: "auto",
          borderBottom: `1px solid ${dark ? "#1e1e28" : "#eee"}`,
          fontSize: 10,
          background: dark ? "#0d0d12" : "#fafafa",
        }}
      >
        {JSON.stringify(state, null, 2)}
      </pre>

      {/* Preset buttons */}
      <div style={{ padding: "8px 12px", display: "flex", flexDirection: "column", gap: 4 }}>
        <div
          style={{
            color: dark ? "#555" : "#aaa",
            fontWeight: 600,
            fontSize: 10,
            marginBottom: 4,
            textTransform: "uppercase",
            letterSpacing: 0.5,
          }}
        >
          Presets
        </div>
        {Object.entries(PRESETS).map(([label, patch]) => (
          <button
            key={label}
            onClick={() => apply(patch)}
            style={{
              padding: "5px 8px",
              background: dark ? "#1c1c26" : "#f5f5f5",
              border: `1px solid ${dark ? "#2a2a35" : "#ddd"}`,
              borderRadius: 4,
              color: dark ? "#ccc" : "#555",
              cursor: "pointer",
              fontSize: 10,
              textAlign: "left",
              transition: "all 0.1s",
              fontFamily: "system-ui",
            }}
            onMouseEnter={(e) => {
              (e.target as HTMLButtonElement).style.background = dark ? "#2a2a35" : "#eee"
            }}
            onMouseLeave={(e) => {
              (e.target as HTMLButtonElement).style.background = dark ? "#1c1c26" : "#f5f5f5"
            }}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  )
}
