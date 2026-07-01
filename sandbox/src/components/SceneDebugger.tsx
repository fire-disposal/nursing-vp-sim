/**
 * Per‑scene debug panel — inspect props, emit bus events.
 * Quick actions are card‑specific and provided by the registry.
 */
import { useState } from "react"
import type { MessageBus } from "../mock/bus"

export interface QuickAction {
  label: string
  emit: { event: string; data: unknown }
}

interface SceneDebuggerProps {
  bus: MessageBus
  props: Record<string, unknown>
  sceneId: string
  quickActions?: QuickAction[]
}

const EVENT_TEMPLATES: Record<string, unknown> = {
  "scene:state": { vitals: { hr: 88, spo2: 97, bp_sys: 120, bp_dia: 80 } },
  "emotion:changed": { state: "anxious", trust: 40, comfort: 35 },
  "scene:interaction": { hotspotId: "chest", metadata: { op_type: "hr" } },
}

export function SceneDebugger({ bus, props, sceneId, quickActions }: SceneDebuggerProps) {
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
    try { bus.emit(eventType, JSON.parse(payload)) } catch { /* no-op */ }
  }

  return (
    <div style={{ borderTop: "1px solid #333", fontSize: 11, fontFamily: "monospace" }}>
      <button onClick={() => setOpen(!open)}
        style={{
          width: "100%", padding: "4px 10px", background: "#1a1a2e", border: "none",
          color: "#777", cursor: "pointer", textAlign: "left", fontSize: 10, fontFamily: "system-ui",
          display: "flex", alignItems: "center", gap: 5,
        }}
      >
        <span style={{ transform: open ? "rotate(90deg)" : "none", transition: "transform 0.1s", fontSize: 8 }}>▶</span>
        Debug {sceneId}
      </button>

      {open && (
        <div style={{ padding: "6px 10px", background: "#12121e", display: "flex", flexDirection: "column", gap: 6 }}>
          <div>
            <div style={{ color: "#555", fontSize: 9, marginBottom: 3, fontWeight: 600 }}>PROPS</div>
            <pre style={{ margin: 0, color: "#999", fontSize: 9, whiteSpace: "pre-wrap", wordBreak: "break-all", lineHeight: 1.4 }}>
              {JSON.stringify(props, null, 2)}
            </pre>
          </div>

          <div>
            <div style={{ color: "#555", fontSize: 9, marginBottom: 3, fontWeight: 600 }}>BUS EMITTER</div>
            <div style={{ display: "flex", gap: 3, marginBottom: 3 }}>
              <select value={eventType} onChange={(e) => handleTypeChange(e.target.value)}
                style={{ flex: 1, padding: "2px 5px", background: "#222", color: "#bbb", border: "1px solid #444", borderRadius: 3, fontSize: 9, fontFamily: "monospace" }}
              >
                {Object.keys(EVENT_TEMPLATES).map((t) => <option key={t} value={t}>{t}</option>)}
                <option value="custom">custom</option>
              </select>
              <button onClick={emit} disabled={!valid}
                style={{ padding: "2px 8px", background: valid ? "#4fc3f7" : "#333", border: "none", borderRadius: 3, color: valid ? "#111" : "#555", cursor: valid ? "pointer" : "not-allowed", fontSize: 9, fontWeight: 600 }}>
                EMIT
              </button>
            </div>
            <textarea value={payload} onChange={(e) => handlePayloadChange(e.target.value)} rows={3}
              style={{ width: "100%", padding: 4, background: "#1a1a2e", color: valid ? "#bbb" : "#e74c3c", border: `1px solid ${valid ? "#444" : "#e74c3c"}`, borderRadius: 3, fontSize: 9, fontFamily: "monospace", resize: "vertical" }}
            />
          </div>

          {quickActions && quickActions.length > 0 && (
            <div>
              <div style={{ color: "#555", fontSize: 9, marginBottom: 3, fontWeight: 600 }}>QUICK — {sceneId}</div>
              <div style={{ display: "flex", gap: 3, flexWrap: "wrap" }}>
                {quickActions.map((qa, i) => (
                  <button key={i} onClick={() => bus.emit(qa.emit.event, qa.emit.data)}
                    style={{ padding: "2px 7px", background: "#2a2a3e", border: "1px solid #444", borderRadius: 3, color: "#bbb", cursor: "pointer", fontSize: 9, fontFamily: "system-ui" }}>
                    {qa.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
