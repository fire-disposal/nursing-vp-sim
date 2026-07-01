import { Suspense, useCallback, useEffect, useRef, useState } from "react"
import type { MessageBus } from "../mock/bus"
import type { MockMessageBus } from "../mock/bus"
import { createMockBus } from "../mock/bus"
import { SANDBOX_SCENES } from "../registry"
import { DebugPanel } from "./DebugPanel"
import { SceneDebugger } from "./SceneDebugger"
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

interface WindowMeta {
  x: number; y: number
  w: number; h: number
  minimized: boolean
  zIndex: number
}

type DockTab = "events" | "state" | "info"

const LS_KEY = "sandbox-windows"
const DOCK_WIDTH = 320

function loadPositions(): Record<string, { x: number; y: number }> {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (!raw) return {}
    return JSON.parse(raw)
  } catch {
    return {}
  }
}

function savePositions(wins: Record<string, { x: number; y: number }>) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(wins))
  } catch {}
}

export function SandboxShell({ initialScene }: { initialScene?: string }) {
  const [bus] = useState(() => createMockBus())
  const [open, setOpen] = useState<Set<string>>(new Set(initialScene ? [initialScene] : []))
  const [wins, setWins] = useState<Record<string, WindowMeta>>(() => {
    const saved = loadPositions()
    const result: Record<string, WindowMeta> = {}
    SANDBOX_SCENES.forEach((s, i) => {
      const p = saved[s.id]
      result[s.id] = {
        x: p?.x ?? 30 + i * 30,
        y: p?.y ?? 20 + i * 40,
        minimized: false,
        zIndex: i + 10,
      }
    })
    return result
  })
  const [showDock, setShowDock] = useState(true)
  const [dockTab, setDockTab] = useState<DockTab>("events")
  const [dark, setDark] = useState(true)
  const [inspectedId, setInspectedId] = useState<string | null>(null)
  const nextZ = useRef(100)
  const dragRef = useRef<{ id: string; ox: number; oy: number; dragging: boolean }>({ id: "", ox: 0, oy: 0, dragging: false })
  const winsRef = useRef(wins)
  winsRef.current = wins

  useEffect(() => {
    const pos: Record<string, { x: number; y: number }> = {}
    for (const [id, m] of Object.entries(wins)) {
      pos[id] = { x: m.x, y: m.y }
    }
    savePositions(pos)
  }, [wins])

  const toggle = useCallback((id: string) => {
    setOpen((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
    const scene = SANDBOX_SCENES.find((s) => s.id === id)
    const sz = scene?.size
    setWins((w) => ({
      ...w,
      [id]: {
        ...w[id],
        w: sz?.w ?? w[id]?.w ?? 400,
        h: sz?.h ?? w[id]?.h ?? 300,
        minimized: false, zIndex: nextZ.current++,
      },
    }))
    setInspectedId(id)
  }, [])

  const bringToFront = useCallback((id: string) => {
    setWins((w) => ({
      ...w,
      [id]: { ...w[id], zIndex: nextZ.current++ },
    }))
  }, [])

  const toggleMinimize = useCallback((id: string) => {
    setWins((w) => ({
      ...w,
      [id]: { ...w[id], minimized: !w[id].minimized },
    }))
  }, [])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && e.target.tagName === "INPUT") return

      const num = parseInt(e.key, 10)
      if (num >= 1 && num <= SANDBOX_SCENES.length && !e.ctrlKey && !e.metaKey) {
        const scene = SANDBOX_SCENES[num - 1]
        if (scene) toggle(scene.id)
        return
      }

      switch (e.key.toLowerCase()) {
        case "t":
          setDark((d) => !d)
          break
        case "escape":
          setOpen(new Set())
          break
      }

      if (e.ctrlKey || e.metaKey) {
        switch (e.key.toLowerCase()) {
          case "d":
            e.preventDefault()
            setShowDock((s) => !s)
            break
          case "b":
            e.preventDefault()
            setDockTab((t) => (t === "state" ? "events" : "state"))
            setShowDock(true)
            break
        }
      }
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [toggle])

  const onHeaderDown = useCallback((e: React.MouseEvent, id: string) => {
    const w = winsRef.current[id]
    if (!w) return
    dragRef.current = { id, ox: e.clientX - w.x, oy: e.clientY - w.y, dragging: true }
    bringToFront(id)

    const onMove = (ev: MouseEvent) => {
      if (!dragRef.current.dragging) return
      setWins((prev) => ({
        ...prev,
        [dragRef.current.id]: {
          ...prev[dragRef.current.id],
          x: ev.clientX - dragRef.current.ox,
          y: ev.clientY - dragRef.current.oy,
        },
      }))
    }
    const onUp = () => { dragRef.current.dragging = false; document.removeEventListener("mousemove", onMove); document.removeEventListener("mouseup", onUp) }
    document.addEventListener("mousemove", onMove)
    document.addEventListener("mouseup", onUp)
  }, [])

  const sceneProps = { bus: bus as MessageBus, mode: "sandbox" as const, recordId: "sandbox" }

  const c = (light: string, darkC: string) => (dark ? darkC : light)

  const inspectedScene = inspectedId ? SANDBOX_SCENES.find((s) => s.id === inspectedId) ?? null : null
  const hasInspected = inspectedId && open.has(inspectedId)

  return (
    <div
      className={dark ? "dark" : ""}
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        background: dark ? "#0d0d12" : "#e8e8ee",
        color: dark ? "#cfcfd8" : "#222",
      }}
    >
      {/* ── Top bar ── */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 4,
          padding: "6px 12px",
          background: dark ? "#16161e" : "#fff",
          borderBottom: `1px solid ${dark ? "#2a2a35" : "#ddd"}`,
          fontFamily: "system-ui",
          fontSize: 13,
          flexWrap: "wrap",
        }}
      >
        <span
          style={{
            fontWeight: 700,
            color: c("#999", "#666"),
            letterSpacing: 1,
            marginRight: 6,
            fontSize: 11,
          }}
        >
          S/B
        </span>
        {SANDBOX_SCENES.map((s) => {
          const isOpen = open.has(s.id)
          return (
            <button
              key={s.id}
              onClick={() => toggle(s.id)}
              title={`${s.name}: ${s.description}`}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 4,
                padding: "4px 8px",
                borderRadius: 5,
                border: `1px solid ${
                  isOpen ? (dark ? "#4fc3f7" : "#0288d1") : dark ? "#2a2a35" : "#ddd"
                }`,
                background: isOpen
                  ? dark ? "#4fc3f718" : "#e3f2fd"
                  : dark ? "#1c1c26" : "#f5f5f5",
                color: isOpen
                  ? dark ? "#4fc3f7" : "#0288d1"
                  : dark ? "#777" : "#666",
                cursor: "pointer",
                fontSize: 11,
                fontFamily: "system-ui",
                transition: "all 0.1s",
              }}
            >
              <span>{ICONS[s.id] ?? "◻"}</span>
              <span>{s.name}</span>
            </button>
          )
        })}

        <div style={{ flex: 1, minWidth: 8 }} />

        <button
          onClick={() => setShowDock((d) => !d)}
          title="Toggle Debug Dock [Ctrl+D]"
          style={{
            padding: "4px 8px",
            borderRadius: 4,
            border: `1px solid ${showDock ? (dark ? "#4fc3f7" : "#0288d1") : dark ? "#2a2a35" : "#ddd"}`,
            background: showDock
              ? dark ? "#4fc3f718" : "#e3f2fd"
              : dark ? "#1c1c26" : "#eee",
            color: showDock
              ? dark ? "#4fc3f7" : "#0288d1"
              : dark ? "#777" : "#555",
            cursor: "pointer",
            fontSize: 11,
            fontFamily: "system-ui",
          }}
        >
          🛠 Debug
        </button>

        <button
          onClick={() => setDark((d) => !d)}
          title="Toggle theme [T]"
          style={{
            padding: "4px 8px",
            borderRadius: 4,
            border: `1px solid ${dark ? "#2a2a35" : "#ddd"}`,
            background: dark ? "#1c1c26" : "#eee",
            color: dark ? "#777" : "#555",
            cursor: "pointer",
            fontSize: 11,
            fontFamily: "system-ui",
          }}
        >
          {dark ? "☀" : "🌙"}
        </button>
      </div>

      {/* ── Main area ── */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        {/* Scene canvas */}
        <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
          {[...open].map((id) => {
            const s = SANDBOX_SCENES.find((sc) => sc.id === id)
            if (!s) return null
            const meta = wins[id]
            if (!meta) return null

            if (meta.minimized) {
              return (
                <div
                  key={id}
                  style={{
                    position: "absolute",
                    left: meta.x,
                    top: meta.y,
                    zIndex: meta.zIndex,
                    background: dark ? "#16161e" : "#f5f5f5",
                    border: `1px solid ${dark ? "#2a2a35" : "#ddd"}`,
                    borderRadius: 6,
                    padding: "4px 10px",
                    cursor: "pointer",
                    fontSize: 11,
                    color: dark ? "#888" : "#666",
                    userSelect: "none",
                    whiteSpace: "nowrap",
                    boxShadow: dark ? "0 2px 12px rgba(0,0,0,0.4)" : "0 2px 8px rgba(0,0,0,0.08)",
                  }}
                  onClick={() => toggleMinimize(id)}
                  title="Click to restore"
                >
                  {ICONS[id] ?? "◻"} {s.name} [min]
                </div>
              )
            }

            return (
              <div
                key={id}
                style={{
                  position: "absolute",
                  left: meta.x,
                  top: meta.y,
                  zIndex: meta.zIndex,
                  minWidth: 320,
                  maxWidth: Math.min(520, window.innerWidth - DOCK_WIDTH - 60),
                  background: dark ? "#16161e" : "#fff",
                  border: `1px solid ${dark ? "#2a2a35" : "#ddd"}`,
                  borderRadius: 8,
                  boxShadow: dark
                    ? "0 8px 40px rgba(0,0,0,0.5)"
                    : "0 4px 24px rgba(0,0,0,0.12)",
                  overflow: "hidden",
                }}
                onMouseDown={() => bringToFront(id)}
              >
                <div
                  onMouseDown={(e) => { onHeaderDown(e, id) }}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "7px 10px",
                    background: dark ? "#1c1c26" : "#f0f0f4",
                    borderBottom: `1px solid ${dark ? "#2a2a35" : "#ddd"}`,
                    cursor: "grab",
                    userSelect: "none",
                    fontSize: 11,
                    color: dark ? "#aaa" : "#555",
                  }}
                >
                  <span>
                    {ICONS[id] ?? "◻"} {s.name}
                  </span>
                  <div style={{ display: "flex", gap: 2 }}>
                    <button
                      onClick={(e) => { e.stopPropagation(); toggleMinimize(id) }}
                      title="Minimize"
                      style={{
                        background: "none",
                        border: "none",
                        color: "#666",
                        cursor: "pointer",
                        fontSize: 12,
                        padding: "1px 5px",
                        borderRadius: 3,
                        lineHeight: 1,
                      }}
                    >
                      _
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); toggle(id) }}
                      title="Close"
                      style={{
                        background: "none",
                        border: "none",
                        color: "#666",
                        cursor: "pointer",
                        fontSize: 12,
                        padding: "1px 5px",
                        borderRadius: 3,
                        lineHeight: 1,
                      }}
                    >
                      ✕
                    </button>
                  </div>
                </div>

                <div style={{ maxHeight: "calc(100vh - 240px)", minHeight: 300, overflow: "auto" }}>
                  <Suspense
                    fallback={
                      <div style={{ padding: 40, textAlign: "center", color: "#555" }}>
                        Loading…
                      </div>
                    }
                  >
                    <s.component {...sceneProps} />
                  </Suspense>
                </div>

                <SceneDebugger bus={bus as MessageBus} props={sceneProps as any} sceneId={id} />

                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "4px 10px",
                    background: dark ? "#0d0d12" : "#fafafa",
                    borderTop: `1px solid ${dark ? "#1e1e28" : "#eee"}`,
                    fontSize: 10,
                    color: dark ? "#555" : "#999",
                    fontFamily: "monospace",
                  }}
                >
                  <span>{s.id}</span>
                  <span>
                    bus:{" "}
                    <span style={{ color: dark ? "#4fc3f7" : "#0288d1" }}>✓</span>
                    {" · "}
                    mode:{" "}
                    <span style={{ color: dark ? "#81c784" : "#388e3c" }}>sandbox</span>
                  </span>
                  <button
                    onClick={() => {
                      setInspectedId(id)
                      setDockTab("info")
                      setShowDock(true)
                    }}
                    title="Inspect in dock"
                    style={{
                      background: "none",
                      border: `1px solid ${dark ? "#333" : "#ddd"}`,
                      borderRadius: 3,
                      color: dark ? "#777" : "#888",
                      cursor: "pointer",
                      fontSize: 9,
                      padding: "1px 6px",
                      fontFamily: "monospace",
                    }}
                  >
                    inspect
                  </button>
                </div>
              </div>
            )
          })}

          {open.size === 0 && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                height: "100%",
                color: dark ? "#333" : "#ccc",
                fontFamily: "system-ui",
                fontSize: 14,
                letterSpacing: 1,
                userSelect: "none",
              }}
            >
              Select a scene above to begin
            </div>
          )}
        </div>

        {/* ── Right dock ── */}
        {showDock && (
          <div
            style={{
              width: DOCK_WIDTH,
              background: dark ? "#121218" : "#f8f8fa",
              borderLeft: `1px solid ${dark ? "#2a2a35" : "#ddd"}`,
              display: "flex",
              flexDirection: "column",
              fontFamily: "system-ui",
              fontSize: 12,
              overflow: "hidden",
              flexShrink: 0,
            }}
          >
            <div
              style={{
                display: "flex",
                borderBottom: `1px solid ${dark ? "#2a2a35" : "#ddd"}`,
                background: dark ? "#0d0d12" : "#f0f0f4",
              }}
            >
              {([
                ["events", "Events"],
                ["state", "State"],
                ["info", "Info"],
              ] as [DockTab, string][]).map(([tab, label]) => (
                <button
                  key={tab}
                  onClick={() => setDockTab(tab)}
                  style={{
                    flex: 1,
                    padding: "7px 0",
                    background: "none",
                    border: "none",
                    borderBottom:
                      dockTab === tab
                        ? `2px solid ${dark ? "#4fc3f7" : "#0288d1"}`
                        : "2px solid transparent",
                    color:
                      dockTab === tab
                        ? dark ? "#4fc3f7" : "#0288d1"
                        : dark ? "#555" : "#888",
                    cursor: "pointer",
                    fontSize: 11,
                    fontFamily: "system-ui",
                    fontWeight: dockTab === tab ? 600 : 400,
                    transition: "all 0.1s",
                  }}
                >
                  {label}
                </button>
              ))}
            </div>

            <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
              {dockTab === "events" && <DebugPanel bus={bus as MockMessageBus} dark={dark} />}
              {dockTab === "state" && <SceneStateEditor bus={bus as MessageBus} dark={dark} />}
              {dockTab === "info" && (
                <div style={{ flex: 1, overflow: "auto", padding: 12, fontSize: 11, color: dark ? "#aaa" : "#555" }}>
                  {hasInspected && inspectedScene ? (
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 13, color: dark ? "#e0e0e0" : "#222", marginBottom: 8 }}>
                        {ICONS[inspectedScene.id] ?? "◻"} {inspectedScene.name}
                      </div>
                      <div style={{ marginBottom: 12, color: dark ? "#888" : "#888" }}>
                        {inspectedScene.description}
                      </div>
                      <Section label="ID" value={inspectedScene.id} dark={dark} />
                      <Section label="Component" value={inspectedScene.component.displayName || inspectedScene.component.name || "Anonymous"} dark={dark} />
                      <Section label="Props received" dark={dark}>
                        <code style={{ color: dark ? "#81c784" : "#388e3c" }}>bus</code>
                        {" | "}
                        <code style={{ color: dark ? "#4fc3f7" : "#0288d1" }}>mode</code>
                        {" | "}
                        <code style={{ color: dark ? "#ce93d8" : "#7b1fa2" }}>recordId</code>
                      </Section>
                      <Section label="Status" dark={dark}>
                        Open · {wins[inspectedScene.id]?.minimized ? "Minimized" : "Active"}
                      </Section>
                    </div>
                  ) : (
                    <div style={{ color: dark ? "#444" : "#bbb", textAlign: "center", paddingTop: 40 }}>
                      {inspectedId
                        ? "Scene is closed — open it to inspect"
                        : "Click \"inspect\" on any window to see details"}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function Section({
  label,
  value,
  children,
  dark,
}: {
  label: string
  value?: string
  children?: React.ReactNode
  dark: boolean
}) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div
        style={{
          fontSize: 9,
          color: dark ? "#555" : "#aaa",
          fontWeight: 600,
          marginBottom: 2,
          textTransform: "uppercase",
          letterSpacing: 0.5,
        }}
      >
        {label}
      </div>
      {value ? (
        <div
          style={{
            color: dark ? "#ccc" : "#444",
            wordBreak: "break-all",
            fontFamily: "monospace",
            fontSize: 12,
          }}
        >
          {value}
        </div>
      ) : (
        <div style={{ fontFamily: "monospace", fontSize: 12 }}>{children}</div>
      )}
    </div>
  )
}
