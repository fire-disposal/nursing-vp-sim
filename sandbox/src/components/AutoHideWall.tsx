import { useRef } from "react"
import { useFrame } from "@react-three/fiber"
import * as THREE from "three"
import { GRID, wallToWorld, type WallDef } from "./GridConfig"

/**
 * Wall mesh that auto-hides when the camera looks through it from outside.
 */
function WallMesh({ def, color }: { def: WallDef; color: string }) {
  const ref = useRef<THREE.Mesh>(null)
  const { position, size } = wallToWorld(def)

  // inward normal derived from wall orientation
  const normal = useRef(new THREE.Vector3())
  const wallPos = useRef(new THREE.Vector3(...position))

  // Pre-compute inward normal
  if (def.axis === "x") {
    normal.current.set(0, 0, def.side === "min" ? 1 : -1)
  } else {
    normal.current.set(def.side === "min" ? 1 : -1, 0, 0)
  }

  useFrame(({ camera }) => {
    if (!ref.current) return
    const dir = new THREE.Vector3().copy(camera.position).sub(wallPos.current).normalize()
    // dot > 0  → camera is on the inward-normal side → wall interior visible → show
    // dot < 0  → camera is behind the wall looking through → wall blocks view → hide
    ref.current.visible = dir.dot(normal.current) > 0
  })

  return (
    <mesh ref={ref} position={position} receiveShadow>
      <boxGeometry args={size} />
      <meshStandardMaterial color={color} roughness={0.9} side={THREE.DoubleSide} />
    </mesh>
  )
}

/** Renders all room walls with grid-based positioning + auto-hide */
export function RoomWalls({ color = "#f0ebe4" }: { color?: string }) {
  return ROOM_WALL_DEFS.map((def, i) => <WallMesh key={i} def={def} color={color} />)
}

const ROOM_WALL_DEFS: WallDef[] = [
  { axis: "x", side: "min", gridPos: { gx: 0, gz: 0 } },
  { axis: "z", side: "min", gridPos: { gx: 0, gz: 0 } },
  { axis: "z", side: "max", gridPos: { gx: 0, gz: 0 } },
]
