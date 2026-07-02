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
    <div className="d-flex flex-column" style={{ height: "100vh" }}>
      {/* Top bar */}
      <div className="d-flex align-items-center gap-1 px-2 border-bottom flex-shrink-0" style={{ background: "#faf6f0", borderColor: "#e0d8d0", fontFamily: "system-ui", height: 28 }}>
        <span className="fw-bold me-1" style={{ color: "#999", letterSpacing: 0.5, fontSize: 10 }}>S/B</span>
        {(["scenes", "furniture", "editor"] as const).map((m) => (
          <button key={m} onClick={() => setModeAndSave(m)}
            className={`btn btn-sm border-0 ${mode === m ? "" : ""}`}
            style={{ fontSize: 9, fontWeight: mode === m ? 600 : 400, padding: "2px 8px", borderRadius: 4, background: mode === m ? "#4fc3f722" : "transparent", color: mode === m ? "#4fc3f7" : "#888" }}>
            {m === "scenes" ? "Scenes" : m === "furniture" ? "Furniture" : "Editor"}
          </button>
        ))}
        <div className="flex-fill" />
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
