import { useEffect, useState } from "react"
import type { MessageBus } from "../mock/bus"
import type { SceneState } from "../scene-types"

/** Subscribes to scene:state & renders current SceneState as expandable JSON */
export function StateViewer({ bus }: { bus: MessageBus }) {
  const [state, setState] = useState<SceneState | null>(null)
  const [open, setOpen] = useState(false)

  useEffect(() => bus.on("scene:state", (s: SceneState) => setState(s)), [bus])

  if (!state) return null

  return (
    <div style={{
      position: "absolute", top: 8, right: 8, zIndex: 10,
      background: "#1a1a2ecc", backdropFilter: "blur(4px)",
      borderRadius: 8, border: "1px solid #333",
      fontFamily: "monospace", fontSize: 11,
      maxWidth: 320, overflow: "hidden",
    }}>
      <button onClick={() => setOpen(!open)}
        style={{ width: "100%", padding: "6px 12px", background: "none", border: "none", color: "#888", cursor: "pointer", textAlign: "left", fontSize: 11, fontWeight: 600 }}>
        SCENE STATE {open ? "▾" : "▸"}
      </button>
      {open && (
        <pre style={{ padding: "8px 12px", margin: 0, color: "#aaa", whiteSpace: "pre-wrap", wordBreak: "break-all", maxHeight: 300, overflow: "auto" }}>
          {JSON.stringify(state, null, 2)}
        </pre>
      )}
    </div>
  )
}
