/**
 * Demo3D — 3D exam room rendered from a Scene DSL.
 *
 * Receives scenes via initialState prop or bus "scene:load" event.
 * Also supports file import via a hidden file input.
 */
import { useMemo, useState, useEffect, useRef } from "react"
import { Canvas } from "@react-three/fiber"
import { OrbitControls } from "@react-three/drei"
import { SceneRenderer3D } from "../components/SceneRenderer3D"
import type { SceneMeta, SceneProps } from "../scene-types"
import type { SceneDSL } from "../components/SceneDSL"

const DEMO_SCENE: SceneDSL = {
  version: 1,
  grid: [
    "00000000000000","00000000000000","00111111111100","00111111111100",
    "00111111111100","00111111111100","00111111111100","00111111111100",
    "00111111111100","00111111111100","00000000000000","00000000000000",
  ],
  items: [
    { id: "bed", gx: 6, gz: 3, rotation: 0, ty: 0 },
    { id: "patient", gx: 6, gz: 4, rotation: 0, ty: 0 },
    { id: "iv", gx: 11, gz: 7, rotation: 0, ty: 0 },
    { id: "monitor", gx: 7, gz: 10, rotation: 0, ty: 0 },
    { id: "chair", gx: 3, gz: 8, rotation: 180, ty: 0 },
    { id: "plant", gx: 1, gz: 10, rotation: 0, ty: 0 },
  ],
  room: { w: 14, d: 12, unit: 1 },
}

export const sceneMeta: SceneMeta = {
  id: "demo-3d", name: "3D 诊室 (R3F)", description: "DSL驱动的 3D 场景", icon: "🏥",
  size: { minW: 500, minH: 320, w: 640, h: 400 },
}

export default function Demo3D({ bus, initialState }: SceneProps) {
  const [scene, setScene] = useState<SceneDSL>(() => {
    const fromState = initialState as { scene?: SceneDSL } | undefined
    return fromState?.scene ?? DEMO_SCENE
  })
  const fileRef = useRef<HTMLInputElement>(null)

  // Listen for bus scene:load events
  useEffect(() => {
    if (!bus) return
    const unsub = bus.on("scene:load", (data: { dsl: SceneDSL }) => {
      if (data?.dsl?.grid && data?.dsl?.items) setScene(data.dsl)
    })
    return unsub
  }, [bus])

  // File picker for loading scene JSON
  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const text = await file.text()
      const dsl = JSON.parse(text) as SceneDSL
      if (dsl.grid && dsl.items) setScene(dsl)
    } catch {}
    e.target.value = ""
  }

  return (
    <div style={{ width: "100%", height: "100%", position: "relative" }}>
      <input ref={fileRef} type="file" accept=".json" onChange={handleFile} style={{ display: "none" }} />
      <button onClick={() => fileRef.current?.click()}
        style={{ position: "absolute", top: 6, right: 6, zIndex: 10, fontSize: 9, padding: "2px 8px", background: "#fff", border: "1px solid #ddd", borderRadius: 4, cursor: "pointer", color: "#555" }}>
        Load Scene
      </button>
      <Canvas orthographic camera={{ position: [6, 5, 7], zoom: 48, near: -10, far: 20 }}
        style={{ width: "100%", height: "100%", background: "#faf6f0", borderRadius: 8 }}
        onCreated={({ gl }) => gl.setClearColor("#faf6f0")}>
        <SceneRenderer3D scene={scene} />
        <OrbitControls enableRotate enableZoom enablePan zoomSpeed={0.8} panSpeed={0.4}
          minZoom={20} maxZoom={120} minPolarAngle={1.1} maxPolarAngle={1.1}
          target={[0, 0.4, 0]} enableDamping dampingFactor={0.12} />
      </Canvas>
    </div>
  )
}
