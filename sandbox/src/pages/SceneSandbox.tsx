/**
 * SceneSandbox — floating‑window scene debug playground.
 *
 * No top bar of its own; the SandboxShell provides mode/theme controls.
 * All colors use var() — theme is CSS‑only via .dark class on <html>.
 */
import { Suspense, useCallback, useEffect, useRef, useState } from "react"
import type { MessageBus } from "../mock/bus"
import type { MockMessageBus } from "../mock/bus"
import { createMockBus } from "../mock/bus"
import { SANDBOX_SCENES } from "../registry"
import { DebugPanel } from "../components/DebugPanel"
import { SceneDebugger } from "../components/SceneDebugger"
import { SceneStateEditor } from "../components/SceneStateEditor"

interface WindowMeta { x: number; y: number; w: number; h: number; minimized: boolean; zIndex: number }

type DockTab = "events" | "state" | "info"
const LS_KEY = "sandbox-windows"
const DOCK_WIDTH = 320
interface SavedPos { x: number; y: number; w?: number; h?: number }
function loadPositions(): Record<string, SavedPos> { try { const r = localStorage.getItem(LS_KEY); return r ? JSON.parse(r) : {} } catch { return {} } }
function savePositions(w: Record<string, SavedPos>) { try { localStorage.setItem(LS_KEY, JSON.stringify(w)) } catch {} }

function useDark(): boolean {
  const [d, setD] = useState(() => document.documentElement.classList.contains("dark"))
  useEffect(() => {
    const obs = new MutationObserver(() => setD(document.documentElement.classList.contains("dark")))
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] })
    return () => obs.disconnect()
  }, [])
  return d
}

export function SceneSandbox({ initialScene }: { initialScene?: string }) {
  const dark = useDark()
  const [bus] = useState(() => createMockBus())
  const [open, setOpen] = useState<Set<string>>(new Set(initialScene ? [initialScene] : []))
  const [wins, setWins] = useState<Record<string, WindowMeta>>(() => {
    const saved = loadPositions()
    const result: Record<string, WindowMeta> = {}
    SANDBOX_SCENES.forEach((s, i) => {
      const p = saved[s.id]; const sz = s.size
      result[s.id] = { x: p?.x ?? 30 + i * 30, y: p?.y ?? 20 + i * 40, w: p?.w ?? sz?.w ?? 400, h: p?.h ?? sz?.h ?? 300, minimized: false, zIndex: i + 10 }
    })
    return result
  })
  const [showDock, setShowDock] = useState(true)
  const [dockTab, setDockTab] = useState<DockTab>("events")
  const [inspectedId, setInspectedId] = useState<string | null>(null)
  const nextZ = useRef(100)
  const dragRef = useRef({ id: "", ox: 0, oy: 0, dragging: false })
  const winsRef = useRef(wins)
  winsRef.current = wins

  useEffect(() => { const pos: Record<string, SavedPos> = {}; for (const [id, m] of Object.entries(wins)) pos[id] = { x: m.x, y: m.y }; savePositions(pos) }, [wins])

  const toggle = useCallback((id: string) => {
    setOpen((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n })
    const sz = SANDBOX_SCENES.find((s) => s.id === id)?.size
    setWins((w) => ({ ...w, [id]: { ...w[id], w: sz?.w ?? w[id]?.w ?? 400, h: sz?.h ?? w[id]?.h ?? 300, minimized: false, zIndex: nextZ.current++ } }))
    setInspectedId(id)
  }, [])

  const bringToFront = useCallback((id: string) => setWins((w) => ({ ...w, [id]: { ...w[id], zIndex: nextZ.current++ } })), [])
  const toggleMinimize = useCallback((id: string) => setWins((w) => ({ ...w, [id]: { ...w[id], minimized: !w[id].minimized } })), [])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && e.target.tagName === "INPUT") return
      const num = parseInt(e.key, 10)
      if (num >= 1 && num <= SANDBOX_SCENES.length && !e.ctrlKey && !e.metaKey) { const s = SANDBOX_SCENES[num - 1]; if (s) toggle(s.id); return }
      switch (e.key.toLowerCase()) { case "escape": setOpen(new Set()); break }
      if (e.ctrlKey || e.metaKey) {
        switch (e.key.toLowerCase()) {
          case "d": e.preventDefault(); setShowDock((s) => !s); break
          case "b": e.preventDefault(); setDockTab((t) => (t === "state" ? "events" : "state")); setShowDock(true); break
        }
      }
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [toggle])

  const onHeaderDown = useCallback((e: React.MouseEvent, id: string) => {
    const w = winsRef.current[id]; if (!w) return
    dragRef.current = { id, ox: e.clientX - w.x, oy: e.clientY - w.y, dragging: true }; bringToFront(id)
    const onMove = (ev: MouseEvent) => { if (!dragRef.current.dragging) return; setWins((p) => ({ ...p, [dragRef.current.id]: { ...p[dragRef.current.id], x: ev.clientX - dragRef.current.ox, y: ev.clientY - dragRef.current.oy } })) }
    const onUp = () => { dragRef.current.dragging = false; document.removeEventListener("mousemove", onMove); document.removeEventListener("mouseup", onUp) }
    document.addEventListener("mousemove", onMove); document.addEventListener("mouseup", onUp)
  }, [])

  const sp = { bus: bus as MessageBus, mode: "sandbox" as const, recordId: "sandbox" }
  const inspectedScene = inspectedId ? SANDBOX_SCENES.find((s) => s.id === inspectedId) ?? null : null
  const hasInspected = inspectedId && open.has(inspectedId)

  return (
    <div style={{ display: "flex", flex: 1, overflow: "hidden", background: "var(--bg)", color: "var(--fg)" }}>
      {/* Scene windows */}
      <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
        {[...open].map((id) => {
          const s = SANDBOX_SCENES.find((sc) => sc.id === id); if (!s) return null
          const m = wins[id]; if (!m) return null
          if (m.minimized) return (
            <div key={id} onClick={() => toggleMinimize(id)} title="Click to restore"
              style={{ position: "absolute", left: m.x, top: m.y, zIndex: m.zIndex, background: "var(--card)", border: "1px solid var(--border)", borderRadius: 6, padding: "4px 10px", cursor: "pointer", fontSize: 11, color: "var(--muted-fg)", userSelect: "none", whiteSpace: "nowrap", boxShadow: "var(--shadow-e2)" }}>
              {s.icon ?? "◻"} {s.name} [min]
            </div>)
          return (
            <div key={id} onMouseDown={() => bringToFront(id)}
              style={{ position: "absolute", left: m.x, top: m.y, zIndex: m.zIndex, minWidth: 320, maxWidth: Math.min(520, window.innerWidth - DOCK_WIDTH - 60), background: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, boxShadow: "var(--shadow-e3)", overflow: "hidden" }}>
              <div onMouseDown={(e) => { onHeaderDown(e, id) }}
                style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "5px 9px", background: "var(--muted)", borderBottom: "1px solid var(--border)", cursor: "grab", userSelect: "none", fontSize: 10, color: "var(--muted-fg)" }}>
                <span style={{ display: "flex", alignItems: "center", gap: 4 }}><span>{s.icon ?? "◻"}</span><span>{s.name}</span></span>
                <div style={{ display: "flex", gap: 2 }}>
                  <button onClick={(e) => { e.stopPropagation(); toggleMinimize(id) }} title="Minimize" style={{ background: "none", border: "none", color: "var(--muted-fg)", cursor: "pointer", fontSize: 10, padding: "1px 4px", borderRadius: 2, lineHeight: 1 }}>_</button>
                  <button onClick={(e) => { e.stopPropagation(); toggle(id) }} title="Close" style={{ background: "none", border: "none", color: "var(--muted-fg)", cursor: "pointer", fontSize: 10, padding: "1px 4px", borderRadius: 2, lineHeight: 1 }}>✕</button>
                </div>
              </div>
              <div style={{ maxHeight: "calc(100vh - 230px)", minHeight: 260, overflow: "auto" }}>
                <Suspense fallback={<div style={{ padding: 30, textAlign: "center", color: "var(--muted-fg)", fontSize: 11 }}>Loading…</div>}>
                  <s.component {...sp} />
                </Suspense>
              </div>
              <SceneDebugger bus={bus as MessageBus} props={sp as any} sceneId={id} />
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "3px 9px", background: "var(--bg)", borderTop: "1px solid var(--border)", fontSize: 9, color: "var(--muted-fg)", fontFamily: "monospace" }}>
                <span>{s.id}</span>
                <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <span>bus <span style={{ color: "var(--accent)" }}>✓</span></span>
                  <span style={{ color: "var(--border)" }}>|</span>
                  <span>mode <span style={{ color: "var(--success)" }}>sandbox</span></span>
                </span>
                <button onClick={() => { setInspectedId(id); setDockTab("info"); setShowDock(true) }} title="Inspect in dock"
                  style={{ background: "none", border: "1px solid var(--border)", borderRadius: 2, color: "var(--muted-fg)", cursor: "pointer", fontSize: 8, padding: "1px 5px", fontFamily: "monospace" }}>inspect</button>
              </div>
            </div>)
        })}
        {open.size === 0 && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "var(--muted-fg)", fontFamily: "system-ui", fontSize: 12, letterSpacing: 0.5, userSelect: "none" }}>
            Select a scene from the right panel
          </div>
        )}
      </div>

      {/* Right sidebar */}
      {showDock && (
        <div style={{ width: DOCK_WIDTH, background: "var(--card)", borderLeft: "1px solid var(--border)", display: "flex", flexDirection: "column", fontSize: 12, overflow: "hidden", flexShrink: 0 }}>
          <div style={{ padding: "5px 8px", borderBottom: "1px solid var(--border)" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
              <span style={{ fontSize: 9, color: "var(--muted-fg)", fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5 }}>Scenes</span>
              <button onClick={() => setShowDock(false)} title="Close dock [Ctrl+D]"
                style={{ padding: "1px 5px", background: "none", border: "1px solid var(--border)", borderRadius: 3, color: "var(--muted-fg)", cursor: "pointer", fontSize: 8, fontFamily: "system-ui" }}>🛠</button>
            </div>
            <div style={{ display: "flex", gap: 3, flexWrap: "wrap" }}>
              {SANDBOX_SCENES.map((s) => {
                const io = open.has(s.id)
                return (<button key={s.id} onClick={() => toggle(s.id)} title={`${s.name}: ${s.description}`}
                  style={{ display: "flex", alignItems: "center", gap: 2, padding: "2px 6px", borderRadius: 3, fontSize: 9, fontFamily: "system-ui", cursor: "pointer",
                    border: `1px solid ${io ? "var(--accent)" : "var(--border)"}`,
                    background: io ? "color-mix(in srgb, var(--accent) 12%, transparent)" : "var(--muted)",
                    color: io ? "var(--accent-fg)" : "var(--muted-fg)" }}>
                  <span style={{ fontSize: 10 }}>{s.icon || "◻"}</span><span>{s.name}</span>
                </button>)
              })}
            </div>
          </div>
          <div style={{ display: "flex", borderBottom: "1px solid var(--border)", background: "var(--bg)" }}>
            {([["events","Events"],["state","State"],["info","Info"]] as [DockTab, string][]).map(([tab, label]) => (
              <button key={tab} onClick={() => setDockTab(tab)}
                style={{ flex: 1, padding: "5px 0", background: "none", border: "none",
                  borderBottom: dockTab === tab ? "2px solid var(--accent)" : "2px solid transparent",
                  color: dockTab === tab ? "var(--accent-fg)" : "var(--muted-fg)",
                  cursor: "pointer", fontSize: 10, fontFamily: "system-ui", fontWeight: dockTab === tab ? 600 : 400 }}>{label}</button>
            ))}
          </div>
          <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
            {dockTab === "events" && <DebugPanel bus={bus as MockMessageBus} dark={dark} />}
            {dockTab === "state" && <SceneStateEditor bus={bus as MessageBus} dark={dark} />}
            {dockTab === "info" && (
              <div style={{ flex: 1, overflow: "auto", padding: 12, fontSize: 11, color: "var(--muted-fg)" }}>
                {hasInspected && inspectedScene ? (<div>
                  <div style={{ fontWeight: 700, fontSize: 13, color: "var(--fg)", marginBottom: 8 }}>{inspectedScene.icon || "◻"} {inspectedScene.name}</div>
                  <div style={{ marginBottom: 12, color: "var(--muted-fg)" }}>{inspectedScene.description}</div>
                  <Section label="ID" value={inspectedScene.id} />
                  <Section label="Component" value={inspectedScene.component.displayName || inspectedScene.component.name || "Anonymous"} />
                  <Section label="Props received"><code style={{ color: "var(--success)" }}>bus</code> | <code style={{ color: "var(--accent)" }}>mode</code> | <code style={{ color: "#ce93d8" }}>recordId</code></Section>
                  <Section label="Status">Open · {wins[inspectedScene.id]?.minimized ? "Minimized" : "Active"}</Section>
                </div>) : (
                  <div style={{ color: "var(--muted-fg)", opacity: 0.5, textAlign: "center", paddingTop: 40 }}>
                    {inspectedId ? "Scene is closed — open it to inspect" : 'Click "inspect" on any window to see details'}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function Section({ label, value, children }: { label: string; value?: string; children?: React.ReactNode }) {
  return (<div style={{ marginBottom: 10 }}>
    <div style={{ fontSize: 9, color: "var(--muted-fg)", fontWeight: 600, marginBottom: 2, textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</div>
    {value ? <div style={{ color: "var(--fg)", wordBreak: "break-all", fontFamily: "monospace", fontSize: 12 }}>{value}</div> : <div style={{ fontFamily: "monospace", fontSize: 12 }}>{children}</div>}
  </div>)
}
