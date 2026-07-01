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

// ── Draggable window ref tracker ──
type Windows = Record<string, { x: number; y: number }>

export function SandboxShell({ initialScene }: { initialScene?: string }) {
  const [bus] = useState(() => createMockBus())
  const [open, setOpen] = useState<Set<string>>(new Set(initialScene ? [initialScene] : []))
  const [wins, setWins] = useState<Windows>({})
  const [showDebug, setShowDebug] = useState(true)
  const [showStateEditor, setShowStateEditor] = useState(false)
  const [dark, setDark] = useState(true)
  const dragRef = useRef<{ id: string; x: number; y: number; dragging: boolean }>({ id: "", x: 0, y: 0, dragging: false })

  const toggle = (id: string) => {
    setOpen((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
        // Assign a staggered position
        const idx = next.size - 1
        setWins((w) => ({ ...w, [id]: { x: 30 + idx * 30, y: 20 + idx * 40 } }))
      }
      return next
    })
  }

  const onHeaderDown = useCallback((e: React.MouseEvent, id: string) => {
    const el = e.currentTarget.parentElement
    if (!el) return
    const rect = el.getBoundingClientRect()
    dragRef.current = { id, x: e.clientX - rect.left, y: e.clientY - rect.top, dragging: true }

    const onMove = (ev: MouseEvent) => {
      if (!dragRef.current.dragging) return
      setWins((w) => ({
        ...w,
        [dragRef.current.id]: { x: ev.clientX - dragRef.current.x, y: ev.clientY - dragRef.current.y },
      }))
    }
    const onUp = () => { dragRef.current.dragging = false; document.removeEventListener("mousemove", onMove); document.removeEventListener("mouseup", onUp) }
    document.addEventListener("mousemove", onMove)
    document.addEventListener("mouseup", onUp)
  }, [])

  const sceneProps = { bus: bus as MessageBus, mode: "sandbox" as const, recordId: "sandbox" }

  return (
    <div className={dark ? "dark" : ""} style={{ display: "flex", flexDirection: "column", height: "100vh", background: dark ? "#111" : "#f0f0f0", color: dark ? "#e0e0e0" : "#222" }}>
      {/* Top bar */}
      <div style={{
        display: "flex", alignItems: "center", gap: 6, padding: "6px 12px",
        background: dark ? "#1a1a1a" : "#fff", borderBottom: `1px solid ${dark ? "#333" : "#ddd"}`,
        fontFamily: "system-ui", fontSize: 13,
      }}>
        <span style={{ fontWeight: 700, color: "#888", letterSpacing: 1, marginRight: 8 }}>SANDBOX</span>
        {SANDBOX_SCENES.map((s) => {
          const isOpen = open.has(s.id)
          return (
            <button key={s.id} onClick={() => toggle(s.id)}
              title={s.name}
              style={{
                display: "flex", alignItems: "center", gap: 4, padding: "5px 10px",
                borderRadius: 6, border: `1px solid ${isOpen ? "#4fc3f7" : (dark ? "#333" : "#ddd")}`,
                background: isOpen ? "#4fc3f718" : (dark ? "#222" : "#f5f5f5"),
                color: isOpen ? "#4fc3f7" : (dark ? "#999" : "#666"),
                cursor: "pointer", fontSize: 12, fontFamily: "system-ui", transition: "all 0.12s",
              }}
            >
              <span>{ICONS[s.id] ?? "◻"}</span>
              <span>{s.name}</span>
            </button>
          )
        })}
        <div style={{ flex: 1 }} />
        <button onClick={() => setDark((d) => !d)}
          title="Toggle dark/light theme"
          style={{
            padding: "4px 8px", borderRadius: 4, border: `1px solid ${dark ? "#444" : "#ddd"}`,
            background: dark ? "#333" : "#eee", color: dark ? "#ccc" : "#555",
            cursor: "pointer", fontSize: 11, fontFamily: "system-ui",
          }}
        >
          {dark ? "☀ Light" : "🌙 Dark"}
        </button>
        <label style={{ display: "flex", alignItems: "center", gap: 4, color: "#888", cursor: "pointer", fontSize: 12 }}>
          <input type="checkbox" checked={showStateEditor} onChange={(e) => setShowStateEditor(e.target.checked)} /> State
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 4, color: "#888", cursor: "pointer", fontSize: 12 }}>
          <input type="checkbox" checked={showDebug} onChange={(e) => setShowDebug(e.target.checked)} /> Debug
        </label>
      </div>

      {/* Scene area */}
      <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
        {/* Floating windows */}
        {[...open].map((id) => {
          const s = SANDBOX_SCENES.find((sc) => sc.id === id)
          if (!s) return null
          const pos = wins[id] ?? { x: 40, y: 60 }
          return (
            <div key={id} style={{
              position: "absolute", left: pos.x, top: pos.y, zIndex: 100,
              minWidth: 320, maxWidth: Math.min(520, window.innerWidth - 40),
              background: dark ? "#1a1a2e" : "#fff",
              border: `1px solid ${dark ? "#333" : "#ddd"}`,
              borderRadius: 10, boxShadow: dark ? "0 8px 40px rgba(0,0,0,0.5)" : "0 4px 24px rgba(0,0,0,0.12)",
              overflow: "hidden",
            }}>
              <div onMouseDown={(e) => onHeaderDown(e, id)}
                style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  padding: "8px 12px", background: dark ? "#222" : "#f5f5f5",
                  borderBottom: `1px solid ${dark ? "#333" : "#ddd"}`,
                  cursor: "grab", userSelect: "none", fontSize: 12, color: dark ? "#ccc" : "#555",
                }}
              >
                <span>{ICONS[id] ?? "◻"} {s.name}</span>
                <button onClick={() => toggle(id)}
                  style={{ background: "none", border: "none", color: "#666", cursor: "pointer", fontSize: 14 }}>
                  ✕
                </button>
              </div>
              <div style={{ maxHeight: "calc(100vh - 180px)", overflow: "auto" }}>
                <Suspense fallback={<div style={{ padding: 40, textAlign: "center", color: "#555" }}>Loading…</div>}>
                  <s.component {...sceneProps} />
                </Suspense>
              </div>
            </div>
          )
        })}
      </div>

      {/* State editor + Debug (right-side) */}
      <div style={{ position: "fixed", right: 0, top: 48, bottom: 0, display: "flex", zIndex: 200, pointerEvents: "none" }}>
        {showStateEditor && <div style={{ pointerEvents: "auto" }}><SceneStateEditor bus={bus} /></div>}
        {showDebug && <div style={{ pointerEvents: "auto" }}><DebugPanel bus={bus as any} /></div>}
      </div>
    </div>
  )
}
