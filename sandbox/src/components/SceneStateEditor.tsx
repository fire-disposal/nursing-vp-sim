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
        fontSize: 10,
        overflow: "auto",
      }}
    >
      {/* Current state JSON */}
      <pre
        style={{
          padding: "6px 10px",
          margin: 0,
          color: dark ? "#aaa" : "#666",
          whiteSpace: "pre-wrap",
          wordBreak: "break-all",
          maxHeight: 180,
          overflow: "auto",
          borderBottom: `1px solid ${dark ? "#1e1e28" : "#eee"}`,
          fontSize: 9,
          lineHeight: 1.4,
          background: dark ? "#0d0d12" : "#fafafa",
        }}
      >
        {JSON.stringify(state, null, 2)}
      </pre>

      {/* Preset buttons */}
      <div style={{ padding: "6px 10px", display: "flex", flexDirection: "column", gap: 3 }}>
        <div
          style={{
            color: dark ? "#555" : "#aaa",
            fontWeight: 600,
            fontSize: 9,
            marginBottom: 2,
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
              padding: "4px 7px",
              background: dark ? "#1c1c26" : "#f5f5f5",
              border: `1px solid ${dark ? "#2a2a35" : "#ddd"}`,
              borderRadius: 3,
              color: dark ? "#ccc" : "#555",
              cursor: "pointer",
              fontSize: 9,
              textAlign: "left",
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
