import { Suspense, useState } from "react"
import { createMockBus } from "../mock/bus"
import type { MessageBus } from "../mock/bus"
import { SANDBOX_SCENES } from "../registry"
import type { SceneProps } from "../scene-types"
import { DebugPanel } from "./DebugPanel"
import { SceneStateEditor } from "./SceneStateEditor"

export function SandboxShell({ initialScene }: { initialScene?: string }) {
  const [bus] = useState(() => createMockBus())
  const [sceneId, setSceneId] = useState(initialScene ?? SANDBOX_SCENES[0]?.id ?? "")
  const [showDebug, setShowDebug] = useState(true)
  const [showStateEditor, setShowStateEditor] = useState(false)

  const scene = SANDBOX_SCENES.find((s) => s.id === sceneId)
  const sceneProps: SceneProps = {
    bus: bus as MessageBus,
    mode: "sandbox",
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", background: "#111" }}>
      {/* Top bar */}
      <div style={{
        display: "flex", alignItems: "center", gap: 12, padding: "8px 16px",
        background: "#1a1a1a", borderBottom: "1px solid #333", fontFamily: "system-ui", fontSize: 14,
      }}>
        <span style={{ fontWeight: 700, color: "#888", letterSpacing: 1 }}>SANDBOX</span>
        <select value={sceneId} onChange={(e) => setSceneId(e.target.value)}
          style={{ padding: "4px 10px", background: "#222", color: "#e0e0e0", border: "1px solid #444", borderRadius: 6, fontSize: 14, cursor: "pointer" }}>
          {SANDBOX_SCENES.map((s) => (
            <option key={s.id} value={s.id}>{s.name} — {s.description}</option>
          ))}
        </select>
        <div style={{ flex: 1 }} />
        <label style={{ display: "flex", alignItems: "center", gap: 4, color: "#888", cursor: "pointer", fontSize: 13 }}>
          <input type="checkbox" checked={showStateEditor} onChange={(e) => setShowStateEditor(e.target.checked)} />
          State
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 4, color: "#888", cursor: "pointer", fontSize: 13 }}>
          <input type="checkbox" checked={showDebug} onChange={(e) => setShowDebug(e.target.checked)} />
          Debug
        </label>
      </div>

      {/* Main area: scene fills the space, debug/state panels are overlaid on the right */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
          {scene ? (
            <Suspense fallback={<div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "#555" }}>Loading…</div>}>
              <scene.component {...sceneProps} />
            </Suspense>
          ) : (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "#555" }}>
              Select a scene
            </div>
          )}
        </div>

        {/* State editor */}
        {showStateEditor && <SceneStateEditor bus={bus} />}

        {/* Debug panel */}
        {showDebug && <DebugPanel bus={bus} />}
      </div>
    </div>
  )
}
