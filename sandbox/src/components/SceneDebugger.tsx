import { useState } from "react"
import type { MessageBus } from "../mock/bus"
import type { QuickAction } from "../scene-types"

interface SceneDebuggerProps {
  bus: MessageBus
  props: Record<string, unknown>
  sceneId: string
  quickActions?: QuickAction[]
}

export function SceneDebugger({ bus, props, sceneId, quickActions }: SceneDebuggerProps) {
  const [open, setOpen] = useState(false)

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
