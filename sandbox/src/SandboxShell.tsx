/**
 * SandboxShell — mode router: SceneSandbox ↔ FurnitureLab ↔ SceneEditor.
 *
 * Always light theme.  Dark mode only exists inside SceneSandbox for
 * component style inspection.
 */
import { lazy, Suspense, useState } from "react"
import { SceneSandbox } from "./pages/SceneSandbox"

const FurnitureLab = lazy(() => import("./pages/FurnitureLab"))
const SceneEditor = lazy(() => import("./pages/SceneEditor"))

export function SandboxShell({ initialScene }: { initialScene?: string }) {
  const [mode, setMode] = useState<"scenes" | "furniture" | "editor">(() =>
    (localStorage.getItem("sandbox:mode") as "scenes" | "furniture" | "editor") || "scenes",
  )

  const setModeAndSave = (m: "scenes" | "furniture" | "editor") => {
    setMode(m)
    localStorage.setItem("sandbox:mode", m)
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
      {/* Top bar — mode tabs only */}
      <div style={{ display: "flex", alignItems: "center", gap: 3, padding: "4px 10px", background: "#faf6f0", borderBottom: "1px solid #e0d8d0", fontFamily: "system-ui", fontSize: 11, flexShrink: 0 }}>
        <span style={{ fontWeight: 700, color: "#999", letterSpacing: 0.5, fontSize: 10, marginRight: 6 }}>S/B</span>
        {(["scenes", "furniture", "editor"] as const).map((m) => (
          <button key={m} onClick={() => setModeAndSave(m)}
            style={{ padding: "2px 8px", borderRadius: 4, border: "none", cursor: "pointer",
              fontSize: 9, fontWeight: mode === m ? 600 : 400, fontFamily: "system-ui",
              background: mode === m ? "#4fc3f722" : "transparent",
              color: mode === m ? "#4fc3f7" : "#888",
            }}>
            {m === "scenes" ? "Scenes" : m === "furniture" ? "Furniture" : "Editor"}
          </button>
        ))}
        <div style={{ flex: 1 }} />
      </div>

      {mode === "furniture" ? (
        <Suspense fallback={<div style={{ display: "flex", alignItems: "center", justifyContent: "center", flex: 1, color: "#888", fontSize: 13 }}>Loading FurnitureLab…</div>}>
          <FurnitureLab />
        </Suspense>
      ) : mode === "editor" ? (
        <Suspense fallback={<div style={{ display: "flex", alignItems: "center", justifyContent: "center", flex: 1, color: "#888", fontSize: 13 }}>Loading Scene Editor…</div>}>
          <SceneEditor />
        </Suspense>
      ) : (
        <SceneSandbox initialScene={initialScene} />
      )}
    </div>
  )
}
