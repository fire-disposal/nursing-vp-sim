/**
 * Grid‑snapping furniture component.
 *
 * Primitives:
 *   <Furniture gx={6} gz={3} rotation={90}>
 *     <Box pos={[0,0.04,0]} size={[2.4,0.08,1.4]} color="#d4b898" />
 *   </Furniture>
 *
 * GLB model:
 *   <Furniture gx={6} gz={3} glb="/models/chair.glb" rotation={90} />
 *
 * `rotation` is in degrees around Y (positive = counter‑clockwise, Three.js right‑hand rule).
 */
import { type ReactNode, Suspense, useMemo } from "react"
import { useGLTF } from "@react-three/drei"
import { gridToWorld } from "./GridConfig"

interface FurnitureProps {
  gx: number; gz: number
  rotation?: number
  glb?: string
  children?: ReactNode
}

const DEG = Math.PI / 180

export function Furniture({ gx, gz, rotation = 0, glb, children }: FurnitureProps) {
  const pos = useMemo(() => gridToWorld({ gx, gz }, 0), [gx, gz])
  const rotY = rotation * DEG

  if (glb) {
    return (
      <Suspense fallback={
        <mesh position={pos} rotation={[0, rotY, 0]} castShadow>
          <boxGeometry args={[0.4, 0.4, 0.4]} />
          <meshStandardMaterial color="#888" roughness={0.8} />
        </mesh>
      }>
        <GLBModel url={glb} position={pos} rotation={[0, rotY, 0]} />
      </Suspense>
    )
  }

  return (
    <group position={pos} rotation={[0, rotY, 0]}>
      {children}
    </group>
  )
}

function GLBModel({ url, position, rotation }: { url: string; position: [number, number, number]; rotation: [number, number, number] }) {
  const { scene } = useGLTF(url)
  const clone = useMemo(() => {
    const c = scene.clone(true)
    c.traverse((child: any) => {
      if (child.isMesh) { child.castShadow = true; child.receiveShadow = true }
    })
    return c
  }, [scene])
  return <primitive object={clone} position={position} rotation={rotation} />
}
