/**
 * Per‑scene debug panel — inspect props, emit bus events, override state.
 * Collapsible footer inside each floating scene window.
 */
import { useState } from "react"
import type { MessageBus } from "../mock/bus"

interface SceneDebuggerProps {
  bus: MessageBus
  props: Record<string, unknown>
  sceneId: string
}

const EVENT_TEMPLATES: Record<string, unknown> = {
  "scene:state": { vitals: { hr: 88, spo2: 97, bp_sys: 120, bp_dia: 80 } },
  "emotion:changed": { state: "anxious", trust: 40, comfort: 35 },
  "scene:interaction": { hotspotId: "chest", metadata: { op_type: "hr" } },
}

export function SceneDebugger({ bus, props, sceneId }: SceneDebuggerProps) {
  const [open, setOpen] = useState(false)
  const [eventType, setEventType] = useState("scene:state")
  const [payload, setPayload] = useState(JSON.stringify(EVENT_TEMPLATES["scene:state"], null, 2))
  const [valid, setValid] = useState(true)

  const handleTypeChange = (t: string) => {
    setEventType(t)
    const tmpl = EVENT_TEMPLATES[t]
    if (tmpl) {
      const str = JSON.stringify(tmpl, null, 2)
      setPayload(str)
      try { JSON.parse(str); setValid(true) } catch { setValid(false) }
    }
  }

  const handlePayloadChange = (v: string) => {
    setPayload(v)
    try { JSON.parse(v); setValid(true) } catch { setValid(false) }
  }

  const emit = () => {
    try {
      const data = JSON.parse(payload)
      bus.emit(eventType, data)
    } catch { /* invalid json — no-op */ }
  }

  return (
    <div style={{ borderTop: "1px solid #333", fontSize: 11, fontFamily: "monospace" }}>
      {/* Header */}
      <button onClick={() => setOpen(!open)}
        style={{
          width: "100%", padding: "6px 12px", background: "#1a1a2e", border: "none",
          color: "#888", cursor: "pointer", textAlign: "left", fontSize: 11, fontFamily: "system-ui",
          display: "flex", alignItems: "center", gap: 6,
        }}
      >
        <span style={{ transform: open ? "rotate(90deg)" : "none", transition: "transform 0.12s" }}>▶</span>
        Debug — {sceneId}
      </button>

      {open && (
        <div style={{ padding: "8px 12px", background: "#12121e", display: "flex", flexDirection: "column", gap: 8 }}>
          {/* Props inspector */}
          <div>
            <div style={{ color: "#666", fontSize: 10, marginBottom: 4, fontWeight: 600 }}>PROPS</div>
            <pre style={{ margin: 0, color: "#aaa", fontSize: 10, whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
              {JSON.stringify(props, null, 2)}
            </pre>
          </div>

          {/* Bus event emitter */}
          <div>
            <div style={{ color: "#666", fontSize: 10, marginBottom: 4, fontWeight: 600 }}>BUS EMITTER</div>
            <div style={{ display: "flex", gap: 4, marginBottom: 4 }}>
              <select value={eventType} onChange={(e) => handleTypeChange(e.target.value)}
                style={{
                  flex: 1, padding: "3px 6px", background: "#222", color: "#ccc",
                  border: "1px solid #444", borderRadius: 4, fontSize: 10, fontFamily: "monospace",
                }}
              >
                {Object.keys(EVENT_TEMPLATES).map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
                <option value="custom">custom</option>
              </select>
              <button onClick={emit} disabled={!valid}
                style={{
                  padding: "3px 10px", background: valid ? "#4fc3f7" : "#333", border: "none",
                  borderRadius: 4, color: valid ? "#111" : "#555", cursor: valid ? "pointer" : "not-allowed",
                  fontSize: 10, fontWeight: 600,
                }}
              >
                EMIT
              </button>
            </div>
            <textarea value={payload} onChange={(e) => handlePayloadChange(e.target.value)}
              rows={4}
              style={{
                width: "100%", padding: 6, background: "#1a1a2e", color: valid ? "#ccc" : "#e74c3c",
                border: `1px solid ${valid ? "#444" : "#e74c3c"}`, borderRadius: 4,
                fontSize: 10, fontFamily: "monospace", resize: "vertical",
              }}
            />
          </div>

          {/* Quick actions */}
          <div>
            <div style={{ color: "#666", fontSize: 10, marginBottom: 4, fontWeight: 600 }}>QUICK</div>
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
              <QBtn label="SpO₂ Low" onClick={() => bus.emit("scene:state", { vitals: { hr: 88, spo2: 91, bp_sys: 130, bp_dia: 85 } })} />
              <QBtn label="Tachy" onClick={() => bus.emit("scene:state", { vitals: { hr: 118, spo2: 97, bp_sys: 120, bp_dia: 80 } })} />
              <QBtn label="Anxious 😰" onClick={() => bus.emit("emotion:changed", { state: "anxious", trust: 35, comfort: 30 })} />
              <QBtn label="Relaxed 😊" onClick={() => bus.emit("emotion:changed", { state: "relaxed", trust: 80, comfort: 75 })} />
              <QBtn label="Chest Click" onClick={() => bus.emit("scene:interaction", { hotspotId: "chest", metadata: { op_type: "hr" } })} />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function QBtn({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button onClick={onClick}
      style={{
        padding: "3px 8px", background: "#2a2a3e", border: "1px solid #444",
        borderRadius: 4, color: "#ccc", cursor: "pointer", fontSize: 10,
        fontFamily: "system-ui",
      }}
    >
      {label}
    </button>
  )
}
