import { useState } from "react"
import type { MessageBus } from "../mock/bus"
import type { QuickAction } from "../scene-types"

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
    if (tmpl) { const s = JSON.stringify(tmpl, null, 2); setPayload(s); try { JSON.parse(s); setValid(true) } catch { setValid(false) } }
  }
  const handlePayloadChange = (v: string) => { setPayload(v); try { JSON.parse(v); setValid(true) } catch { setValid(false) } }
  const emit = () => { try { bus.emit(eventType, JSON.parse(payload)) } catch {} }

  return (
    <div style={{ borderTop: "1px solid #dee2e6", fontSize: 11, fontFamily: "monospace" }}>
      <button onClick={() => setOpen(!open)}
        className="d-flex align-items-center w-100 border-0 py-1 px-2"
        style={{ background: "#f0f0f4", color: "#6c757d", cursor: "pointer", fontSize: 10, fontFamily: "system-ui", gap: 4 }}>
        <span style={{ transform: open ? "rotate(90deg)" : "none", fontSize: 8, transition: "transform 0.1s" }}>▶</span>
        <span className="fw-medium">{sceneId}</span>
        <span className="badge bg-light text-muted fw-normal ms-1" style={{ fontSize: 8 }}>debug</span>
        <span className="ms-auto badge" style={{ fontSize: 8, background: "#e9ecef", color: "#6c757d" }}>{Object.keys(props).length} props</span>
      </button>

      {open && (
        <div className="d-flex flex-column" style={{ background: "#f8f9fa" }}>
          {/* PROPS — collapsible row */}
          <details className="px-2 py-1" open>
            <summary className="small fw-semibold" style={{ color: "#6c757d", fontSize: 9, cursor: "pointer" }}>PROPS ({Object.keys(props).length})</summary>
            <pre className="mb-0 mt-1" style={{ color: "#6c757d", fontSize: 9, whiteSpace: "pre-wrap", wordBreak: "break-all", lineHeight: 1.4, maxHeight: 120, overflow: "auto" }}>
              {JSON.stringify(props, null, 2)}
            </pre>
          </details>

          {/* BUS EMITTER — inline form */}
          <div className="px-2 py-1 border-top" style={{ borderColor: "#e9ecef" }}>
            <div className="small fw-semibold mb-1" style={{ color: "#6c757d", fontSize: 9 }}>BUS EMITTER</div>
            <div className="d-flex gap-1 mb-1">
              <select value={eventType} onChange={(e) => handleTypeChange(e.target.value)}
                className="form-select form-select-sm" style={{ fontSize: 9, maxWidth: 160 }}>
                {Object.keys(EVENT_TEMPLATES).map((t) => <option key={t} value={t}>{t}</option>)}
                <option value="custom">custom</option>
              </select>
              <button onClick={emit} disabled={!valid}
                className="btn btn-sm" style={{ background: valid ? "#4fc3f7" : "#adb5bd", color: "#fff", fontSize: 9, fontWeight: 600, border: "none", padding: "2px 12px" }}>
                EMIT
              </button>
            </div>
            <textarea value={payload} onChange={(e) => handlePayloadChange(e.target.value)} rows={2}
              className="form-control form-control-sm" style={{ fontSize: 9, fontFamily: "monospace", borderColor: valid ? "#dee2e6" : "#e74c3c", resize: "vertical" }} />
          </div>

          {/* QUICK ACTIONS */}
          {quickActions && quickActions.length > 0 && (
            <div className="px-2 py-1 border-top" style={{ borderColor: "#e9ecef" }}>
              <div className="small fw-semibold mb-1" style={{ color: "#6c757d", fontSize: 9 }}>QUICK — {sceneId}</div>
              <div className="d-flex gap-1 flex-wrap">
                {quickActions.map((qa, i) => (
                  <button key={i} onClick={() => bus.emit(qa.emit.event, qa.emit.data)}
                    className="btn btn-sm border" style={{ fontSize: 9, background: "#fff", borderColor: "#dee2e6", color: "#6c757d", padding: "2px 10px" }}>
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
