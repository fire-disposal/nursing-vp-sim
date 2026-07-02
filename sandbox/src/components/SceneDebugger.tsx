import { useState } from "react"
import type { MessageBus } from "../mock/bus"
import type { QuickAction } from "../scene-types"

interface SceneDebuggerProps {
  bus: MessageBus
  props: Record<string, unknown>
  sceneId: string
  quickActions?: QuickAction[]
  /** Whether this scene window is in dark mode. */
  dark?: boolean
}

const EVENT_TEMPLATES: Record<string, unknown> = {
  "scene:state": { vitals: { hr: 88, spo2: 97, bp_sys: 120, bp_dia: 80 } },
  "emotion:changed": { state: "anxious", trust: 40, comfort: 35 },
  "scene:interaction": { hotspotId: "chest", metadata: { op_type: "hr" } },
}

export function SceneDebugger({ bus, props, sceneId, quickActions, dark = false }: SceneDebuggerProps) {
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

  const c = (light: string, d: string) => dark ? d : light
  const BG = c("#f8f9fa", "#1a1a2e"); const TEXT = c("#6c757d", "#999"); const BORDER = c("#dee2e6", "#444")
  const INPUT = c("#fff", "#222"); const INPUT_TEXT = c("#495057", "#bbb")

  return (
    <div className={dark ? "" : ""} style={{ borderTop: `1px solid ${BORDER}`, fontSize: 11, fontFamily: "monospace" }}>
      <button onClick={() => setOpen(!open)}
        className="d-flex align-items-center w-100 border-0 py-1 px-2"
        style={{ background: c("#f0f0f4", "#1a1a2e"), color: TEXT, cursor: "pointer", fontSize: 10, fontFamily: "system-ui", gap: 4 }}>
        <span style={{ transform: open ? "rotate(90deg)" : "none", fontSize: 8, transition: "transform 0.1s" }}>▶</span>
        Debug {sceneId}
      </button>

      {open && (
        <div className="d-flex flex-column px-2 py-1" style={{ background: BG, gap: 4 }}>
          <div>
            <div className="small fw-semibold mb-1" style={{ color: TEXT, fontSize: 9 }}>PROPS</div>
            <pre className="mb-0" style={{ color: c("#6c757d", "#999"), fontSize: 9, whiteSpace: "pre-wrap", wordBreak: "break-all", lineHeight: 1.4, margin: 0 }}>
              {JSON.stringify(props, null, 2)}
            </pre>
          </div>
          <div>
            <div className="small fw-semibold mb-1" style={{ color: TEXT, fontSize: 9 }}>BUS EMITTER</div>
            <div className="d-flex gap-1 mb-1">
              <select value={eventType} onChange={(e) => handleTypeChange(e.target.value)}
                className="form-select form-select-sm" style={{ fontSize: 9, background: INPUT, color: INPUT_TEXT, border: `1px solid ${BORDER}` }}>
                {Object.keys(EVENT_TEMPLATES).map((t) => <option key={t} value={t}>{t}</option>)}
                <option value="custom">custom</option>
              </select>
              <button onClick={emit} disabled={!valid}
                className="btn btn-sm border-0" style={{ background: valid ? "#4fc3f7" : "#6c757d", color: valid ? "#111" : "#fff", fontSize: 9, fontWeight: 600, padding: "2px 10px" }}>
                EMIT
              </button>
            </div>
            <textarea value={payload} onChange={(e) => handlePayloadChange(e.target.value)} rows={3}
              className="form-control form-control-sm" style={{ fontSize: 9, fontFamily: "monospace", background: INPUT, color: valid ? INPUT_TEXT : "#e74c3c", borderColor: valid ? BORDER : "#e74c3c", resize: "vertical" }} />
          </div>
          {quickActions && quickActions.length > 0 && (
            <div>
              <div className="small fw-semibold mb-1" style={{ color: TEXT, fontSize: 9 }}>QUICK — {sceneId}</div>
              <div className="d-flex gap-1 flex-wrap">
                {quickActions.map((qa, i) => (
                  <button key={i} onClick={() => bus.emit(qa.emit.event, qa.emit.data)}
                    className="btn btn-sm border" style={{ fontSize: 9, background: c("#f8f9fa", "#2a2a3e"), borderColor: BORDER, color: TEXT, padding: "2px 8px" }}>
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
