import type { ReactNode } from "react"
import { Canvas } from "@react-three/fiber"
import { ContactShadows, OrbitControls } from "@react-three/drei"

/** Pre-wired R3F canvas with lighting, shadows & controls for sandbox scenes */
export function SceneCanvas({ children, bg = "#1a1a2a" }: { children: ReactNode; bg?: string }) {
  return (
    <Canvas
      camera={{ position: [3, 2.5, 4], fov: 50 }}
      shadows
      style={{ background: bg, width: "100%", height: "100%" }}
    >
      <ambientLight intensity={0.4} />
      <directionalLight position={[5, 5, 5]} intensity={0.8} castShadow shadow-mapSize-width={1024} shadow-mapSize-height={1024} />
      <directionalLight position={[-3, 4, -2]} intensity={0.3} />
      <hemisphereLight args={["#4a6a8a", "#2a2a3a", 0.3]} />

      {children}

      <ContactShadows position={[0, -0.01, 0]} opacity={0.4} scale={10} blur={2} far={4} />
      <OrbitControls minPolarAngle={Math.PI / 6} maxPolarAngle={Math.PI / 2.2} minDistance={2} maxDistance={8} makeDefault />
      <gridHelper args={[8, 8, "#444", "#333"]} position={[0, -0.005, 0]} />
    </Canvas>
  )
}
