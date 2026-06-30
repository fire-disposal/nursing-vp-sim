import { useCallback, useEffect, useState } from "react"
import { useThree } from "@react-three/fiber"
import { Html, Stats } from "@react-three/drei"
import * as THREE from "three"
import { useSceneHotkeys } from "./useSceneHotkeys"

const btn: React.CSSProperties = {
  width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center",
  background: "#1a1a2ecc", border: "1px solid #444", borderRadius: 6,
  color: "#ccc", cursor: "pointer", fontSize: 15, backdropFilter: "blur(4px)",
  transition: "all 0.15s",
}

export function SceneTools({ controlsRef }: { controlsRef: React.RefObject<any> }) {
  const { camera, gl, scene } = useThree()
  const [showStats, setShowStats] = useState(false)
  const [wf, setWf] = useState(false)
  const [showHelp, setShowHelp] = useState(false)

  useEffect(() => {
    scene.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        const m = child.material as THREE.MeshStandardMaterial
        if (m && "wireframe" in m) m.wireframe = wf
      }
    })
  }, [wf, scene])

  const screenshot = useCallback(() => {
    gl.render(scene, camera)
    const link = document.createElement("a")
    link.download = `sandbox-${Date.now()}.png`
    link.href = gl.domElement.toDataURL("image/png")
    link.click()
  }, [gl, scene, camera])

  const resetCamera = useCallback(() => {
    if (!controlsRef.current) return
    controlsRef.current.target.set(0, 0.4, 0)
    controlsRef.current.object.position.set(6, 5, 7)
    controlsRef.current.update()
  }, [controlsRef])

  useSceneHotkeys({
    r: resetCamera,
    s: screenshot,
    w: () => setWf((p) => !p),
    f: () => setShowStats((p) => !p),
    h: () => setShowHelp((p) => !p),
  })

  return (
    <>
      {showStats && <Stats />}
      <Html fullscreen style={{ pointerEvents: "none" }}>
        {/* Bottom-right toolbar */}
        <div style={{
          position: "absolute", bottom: 80, right: 16,
          display: "flex", flexDirection: "column", gap: 6, pointerEvents: "auto",
          zIndex: 5,
        }}>
          <button style={btn} onClick={screenshot} title="截图 [S]">📷</button>
          <button style={{ ...btn, background: wf ? "#4fc3f722" : "#1a1a2ecc" }} onClick={() => setWf((p) => !p)} title="线框 [W]">
            <span style={{ color: wf ? "#4fc3f7" : "#ccc" }}>◇</span>
          </button>
          <button style={btn} onClick={resetCamera} title="复位视角 [R]">⌖</button>
          <button style={{ ...btn, background: showStats ? "#4fc3f722" : "#1a1a2ecc" }} onClick={() => setShowStats((p) => !p)} title="性能 [F]">
            <span style={{ fontSize: 11, fontWeight: 700, color: showStats ? "#4fc3f7" : "#ccc" }}>FPS</span>
          </button>
          <button style={{ ...btn, background: showHelp ? "#4fc3f722" : "#1a1a2ecc" }} onClick={() => setShowHelp((p) => !p)} title="帮助 [H]">
            <span style={{ fontWeight: 700, fontSize: 13, color: showHelp ? "#4fc3f7" : "#ccc" }}>?</span>
          </button>
        </div>

        {/* Help overlay */}
        {showHelp && (
          <div style={{
            position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center",
            background: "rgba(0,0,0,0.5)", pointerEvents: "auto", zIndex: 20, fontFamily: "system-ui",
          }} onClick={() => setShowHelp(false)}>
            <div style={{
              background: "#1a1a2e", border: "1px solid #444", borderRadius: 12, padding: "24px 32px",
              maxWidth: 360, color: "#ccc", fontSize: 13,
            }} onClick={(e) => e.stopPropagation()}>
              <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 12, color: "#fff" }}>快捷键</div>
              <div style={{ display: "grid", gridTemplateColumns: "40px 1fr", gap: "6px 12px" }}>
                <span style={{ color: "#4fc3f7", fontFamily: "monospace" }}>R</span><span>复位视角</span>
                <span style={{ color: "#4fc3f7", fontFamily: "monospace" }}>S</span><span>截图</span>
                <span style={{ color: "#4fc3f7", fontFamily: "monospace" }}>W</span><span>切换线框</span>
                <span style={{ color: "#4fc3f7", fontFamily: "monospace" }}>F</span><span>切换 FPS</span>
                <span style={{ color: "#4fc3f7", fontFamily: "monospace" }}>H</span><span>帮助</span>
              </div>
              <div style={{ marginTop: 12, color: "#666", fontSize: 11 }}>点击任意处关闭</div>
            </div>
          </div>
        )}
      </Html>
    </>
  )
}
