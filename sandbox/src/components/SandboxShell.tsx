import { Suspense, useCallback, useRef, useState } from "react"
import { createMockBus } from "../mock/bus"
import type { MessageBus } from "../mock/bus"
import { SANDBOX_SCENES } from "../registry"
import { DebugPanel } from "./DebugPanel"
import { SceneStateEditor } from "./SceneStateEditor"

const ICONS: Record<string, string> = {
  "demo-2d": "🖱️",
  "demo-3d": "🏥",
  "demo-exam": "🩺",
  "card-patient": "👤",
  "card-inquiry": "📋",
  "card-monitor": "💓",
  "card-notes": "📝",
}

export function SandboxShell({ initialScene }: { initialScene?: string }) {
  const [bus] = useState(() => createMockBus())
  const [activeId, setActiveId] = useState<string | null>(initialScene ?? null)
  const [showDebug, setShowDebug] = useState(true)
  const [showStateEditor, setShowStateEditor] = useState(false)
  const [pos, setPos] = useState({ x: 40, y: 60 })
  const dragRef = useRef({ x: 0, y: 0, dragging: false })

  const scene = activeId ? SANDBOX_SCENES.find((s) => s.id === activeId) : null

  const onHeaderDown = useCallback((e: React.MouseEvent) => {
    const el = e.currentTarget.parentElement
    if (!el) return
    const rect = el.getBoundingClientRect()
    dragRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top, dragging: true }

    const onMove = (ev: MouseEvent) => {
      if (!dragRef.current.dragging) return
      setPos({ x: ev.clientX - dragRef.current.x, y: ev.clientY - dragRef.current.y })
    }
    const onUp = () => { dragRef.current.dragging = false; document.removeEventListener("mousemove", onMove); document.removeEventListener("mouseup", onUp) }
    document.addEventListener("mousemove", onMove)
    document.addEventListener("mouseup", onUp)
  }, [])

  const sceneProps = { bus: bus as MessageBus, mode: "sandbox" as const, recordId: "sandbox" }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", background: "#111" }}>
      {/* Top bar — icon palette */}
      <div style={{
        display: "flex", alignItems: "center", gap: 6, padding: "6px 12px",
        background: "#1a1a1a", borderBottom: "1px solid #333", fontFamily: "system-ui", fontSize: 13,
      }}>
        <span style={{ fontWeight: 700, color: "#888", letterSpacing: 1, marginRight: 8 }}>SANDBOX</span>
        {SANDBOX_SCENES.map((s) => {
          const isActive = activeId === s.id
          return (
            <button key={s.id} onClick={() => setActiveId(isActive ? null : s.id)}
              title={s.name}
              style={{
                display: "flex", alignItems: "center", gap: 4, padding: "5px 10px",
                borderRadius: 6, border: `1px solid ${isActive ? "#4fc3f7" : "#333"}`,
                background: isActive ? "#4fc3f718" : "#222",
                color: isActive ? "#4fc3f7" : "#999",
                cursor: "pointer", fontSize: 12, fontFamily: "system-ui",
                transition: "all 0.12s",
              }}
            >
              <span>{ICONS[s.id] ?? "◻"}</span>
              <span>{s.name}</span>
            </button>
          )
        })}
        <div style={{ flex: 1 }} />
        <label style={{ display: "flex", alignItems: "center", gap: 4, color: "#888", cursor: "pointer", fontSize: 12 }}>
          <input type="checkbox" checked={showStateEditor} onChange={(e) => setShowStateEditor(e.target.checked)} /> State
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 4, color: "#888", cursor: "pointer", fontSize: 12 }}>
          <input type="checkbox" checked={showDebug} onChange={(e) => setShowDebug(e.target.checked)} /> Debug
        </label>
      </div>

      {/* Scene area — clickable icons at top, draggable floating window below */}
      <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
        {scene && (
          <div style={{
            position: "absolute", left: pos.x, top: pos.y,
            zIndex: 100, minWidth: 320, maxWidth: 520,
            background: "#1a1a2e", border: "1px solid #333", borderRadius: 10,
            boxShadow: "0 8px 40px rgba(0,0,0,0.5)", overflow: "hidden",
          }}>
            {/* Header */}
            <div onMouseDown={onHeaderDown}
              style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                padding: "8px 12px", background: "#222", borderBottom: "1px solid #333",
                cursor: "grab", userSelect: "none", fontSize: 12, color: "#ccc",
              }}
            >
              <span>{ICONS[scene.id] ?? "◻"} {scene.name}</span>
              <button onClick={() => setActiveId(null)}
                style={{ background: "none", border: "none", color: "#666", cursor: "pointer", fontSize: 14 }}>
                ✕
              </button>
            </div>
            {/* Body */}
            <div style={{ maxHeight: "calc(100vh - 200px)", overflow: "auto" }}>
              <Suspense fallback={<div style={{ padding: 40, textAlign: "center", color: "#555" }}>Loading…</div>}>
                <scene.component {...sceneProps} />
              </Suspense>
            </div>
          </div>
        )}
      </div>

      {/* State editor + Debug (right-side panels) */}
      <div style={{ position: "fixed", right: 0, top: 48, bottom: 0, display: "flex", zIndex: 200, pointerEvents: "none" }}>
        {showStateEditor && <div style={{ pointerEvents: "auto" }}><SceneStateEditor bus={bus} /></div>}
        {showDebug && <div style={{ pointerEvents: "auto" }}><DebugPanel bus={bus as any} /></div>}
      </div>
    </div>
  )
}
