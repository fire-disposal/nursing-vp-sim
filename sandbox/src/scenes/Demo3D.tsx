/**
 * Demo3D — 3D scene renderer driven by bus scene:load events.
 *
 * Starts empty.  Send a Scene DSL via the BUS EMITTER in the Events dock
 * using the "scene:load" template to populate the room.
 */
import { useState, useEffect } from "react"
import { Canvas } from "@react-three/fiber"
import { OrbitControls } from "@react-three/drei"
import { SceneRenderer3D } from "../components/SceneRenderer3D"
import { emptyScene, type SceneDSL } from "../components/SceneDSL"
import type { SceneMeta, SceneProps } from "../scene-types"
import * as THREE from "three"

export const sceneMeta: SceneMeta = {
  id: "demo-3d", name: "3D 诊室 (R3F)", description: "空场景 — 通过 BUS EMITTER 发送 scene:load 注入 DSL", icon: "🏥",
  size: { minW: 640, minH: 360, w: 800, h: 450 },
}

export default function Demo3D({ bus, initialState }: SceneProps) {
  const [scene, setScene] = useState<SceneDSL>(() => {
    const fromState = initialState as { scene?: SceneDSL } | undefined
    return fromState?.scene ?? emptyScene()
  })

  useEffect(() => {
    if (!bus) return
    const unsub = bus.on("scene:load", (data: { dsl: SceneDSL }) => {
      if (data?.dsl?.grid && data?.dsl?.items) setScene(data.dsl)
    })
    return unsub
  }, [bus])

  return (
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "#faf6f0", borderRadius: 8 }}>
      <div style={{ width: "100%", maxWidth: 800, aspectRatio: "16/9" }}>
        <Canvas orthographic camera={{ position: [6, 5, 7], zoom: 44, near: -10, far: 20 }}
          style={{ width: "100%", height: "100%", background: "#faf6f0", borderRadius: 8 }}
          onCreated={({ gl }) => gl.setClearColor("#faf6f0")}>
          <SceneRenderer3D scene={scene} />
          <OrbitControls enableRotate enableZoom enablePan zoomSpeed={0.8} panSpeed={0.4}
            minZoom={15} maxZoom={80} minPolarAngle={0.2} maxPolarAngle={1.3}
            target={[0, 0.8, 0]} enableDamping dampingFactor={0.1}
            mouseButtons={{ LEFT: undefined, MIDDLE: THREE.MOUSE.ROTATE, RIGHT: THREE.MOUSE.PAN }} />
        </Canvas>
      </div>
    </div>
  )
}
