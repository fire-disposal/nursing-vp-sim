/**
 * SandboxShell — persistent app shell with mode routing.
 *
 * Theme is CSS‑only via .dark class on <html>; all components
 * use var() references in inline styles.
 */
import { lazy, Suspense, useEffect, useState } from "react"
import { SceneSandbox } from "./pages/SceneSandbox"

const FurnitureLab = lazy(() => import("./pages/FurnitureLab"))
const SceneEditor = lazy(() => import("./pages/SceneEditor"))

export function SandboxShell({ initialScene }: { initialScene?: string }) {
  const [mode, setMode] = useState<"scenes" | "furniture" | "editor">("scenes")

  // Sync .dark class on <html> — T key toggles
  useEffect(() => {
    const html = document.documentElement
    const handler = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "t" && !e.ctrlKey && !e.metaKey && !(e.target instanceof HTMLElement && e.target.tagName === "INPUT"))
        html.classList.toggle("dark")
    }
    // Start dark
    if (!html.classList.contains("dark")) html.classList.add("dark")
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [])

  const toggleDark = () => document.documentElement.classList.toggle("dark")

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
      {/* ── Persistent top bar ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 3, padding: "4px 10px", background: "var(--card)", borderBottom: "1px solid var(--border)", fontFamily: "system-ui", fontSize: 11, flexShrink: 0 }}>
        <span style={{ fontWeight: 700, color: "var(--muted-fg)", letterSpacing: 0.5, fontSize: 10, marginRight: 6 }}>S/B</span>

        {(["scenes", "furniture", "editor"] as const).map((m) => (
          <button key={m} onClick={() => setMode(m)}
            style={{
              padding: "2px 8px", borderRadius: 4, border: "none", cursor: "pointer",
              fontSize: 9, fontWeight: mode === m ? 600 : 400, fontFamily: "system-ui",
              background: mode === m ? "color-mix(in srgb, var(--accent) 15%, transparent)" : "transparent",
              color: mode === m ? "var(--accent-fg)" : "var(--muted-fg)",
            }}>
            {m === "scenes" ? "Scenes" : m === "furniture" ? "Furniture" : "Editor"}
          </button>
        ))}

        <div style={{ flex: 1 }} />

        <button onClick={toggleDark} title="Theme [T]"
          style={{ padding: "2px 6px", borderRadius: 3, border: "none", cursor: "pointer", fontSize: 10, background: "transparent", color: "var(--muted-fg)" }}>
          <ThemeIcon />
        </button>
      </div>

      {mode === "furniture" ? (
        <Suspense fallback={<div style={{ display: "flex", alignItems: "center", justifyContent: "center", flex: 1, color: "var(--muted-fg)", fontSize: 13 }}>Loading FurnitureLab…</div>}>
          <FurnitureLab />
        </Suspense>
      ) : mode === "editor" ? (
        <Suspense fallback={<div style={{ display: "flex", alignItems: "center", justifyContent: "center", flex: 1, color: "var(--muted-fg)", fontSize: 13 }}>Loading Scene Editor…</div>}>
          <SceneEditor />
        </Suspense>
      ) : (
        <SceneSandbox initialScene={initialScene} />
      )}
    </div>
  )
}

function ThemeIcon() {
  const [d, setD] = useState(document.documentElement.classList.contains("dark"))
  useEffect(() => {
    const obs = new MutationObserver(() => setD(document.documentElement.classList.contains("dark")))
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] })
    return () => obs.disconnect()
  }, [])
  return <>{d ? "☀" : "🌙"}</>
}
