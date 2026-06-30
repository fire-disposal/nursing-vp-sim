import { type ReactNode, useRef } from "react"
import { Canvas } from "@react-three/fiber"
import { ContactShadows, OrbitControls } from "@react-three/drei"
import { R3FErrorBoundary } from "./R3FErrorBoundary"
import { SceneTools } from "./SceneTools"

interface SceneCanvasProps {
  children: ReactNode
  bg?: string
  showTools?: boolean
  /** For perspective scenes; orthographic scenes manage their own camera */
  cameraPos?: [number, number, number]
  controls?: Partial<{
    minPolarAngle: number
    maxPolarAngle: number
    minDistance: number
    maxDistance: number
    enableRotate: boolean
    enableZoom: boolean
    rotateSpeed: number
    zoomSpeed: number
  }>
}

/**
 * Pre‑wired R3F canvas with lighting, shadows, orbit controls,
 * optional dev tools, and error boundary.
 */
export function SceneCanvas({
  children, bg = "#1a1a2a", showTools = false, cameraPos = [3, 2.5, 4],
  controls,
}: SceneCanvasProps) {
  const orbitRef = useRef<any>(null)

  return (
    <R3FErrorBoundary>
      <Canvas
        camera={{ position: cameraPos, fov: 50 }}
        shadows
        style={{ background: bg, width: "100%", height: "100%" }}
      >
        <ambientLight intensity={0.4} />
        <directionalLight position={[5, 5, 5]} intensity={0.8} castShadow shadow-mapSize-width={1024} shadow-mapSize-height={1024} />
        <directionalLight position={[-3, 4, -2]} intensity={0.3} />
        <hemisphereLight args={["#4a6a8a", "#2a2a3a", 0.3]} />

        {children}

        <ContactShadows position={[0, -0.01, 0]} opacity={0.4} scale={10} blur={2} far={4} />
        <OrbitControls
          ref={orbitRef}
          minPolarAngle={controls?.minPolarAngle ?? Math.PI / 6}
          maxPolarAngle={controls?.maxPolarAngle ?? Math.PI / 2.2}
          minDistance={controls?.minDistance ?? 2}
          maxDistance={controls?.maxDistance ?? 8}
          enableRotate={controls?.enableRotate ?? true}
          enableZoom={controls?.enableZoom ?? true}
          rotateSpeed={controls?.rotateSpeed ?? 1}
          zoomSpeed={controls?.zoomSpeed ?? 1}
          makeDefault
        />
        <gridHelper args={[8, 8, "#444", "#333"]} position={[0, -0.005, 0]} />

        {showTools && <SceneTools controlsRef={orbitRef} />}
      </Canvas>
    </R3FErrorBoundary>
  )
}
