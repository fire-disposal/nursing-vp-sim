import { useMemo, useState, useCallback } from "react"
import { useFrame } from "@react-three/fiber"
import { Furniture } from "./Furniture"
import { gridToWorld } from "./GridConfig"
import { FURNI } from "../data/furniture-catalog"
import { type SceneDSL, parseGrid } from "./SceneDSL"
import * as THREE from "three"

function computeWalls(floor: boolean[][]): { x: number; z: number; nx: number; nz: number }[] {
  const w: any[] = []; const D = floor.length; const W = floor[0]?.length ?? 0
  for (let z = 0; z < D; z++) for (let x = 0; x < W; x++) {
    if (!floor[z][x]) continue
    if (z === 0 || !floor[z - 1][x]) w.push({ x, z, nx: 0, nz: -1 })
    if (z === D - 1 || !floor[z + 1][x]) w.push({ x, z, nx: 0, nz: 1 })
    if (x === 0 || !floor[z][x - 1]) w.push({ x, z, nx: -1, nz: 0 })
    if (x === W - 1 || !floor[z][x + 1]) w.push({ x, z, nx: 1, nz: 0 })
  }
  return w
}

export function SceneRenderer3D({ scene }: { scene: SceneDSL }) {
  const floor = useMemo(() => parseGrid(scene.grid), [scene.grid])
  const walls = useMemo(() => computeWalls(floor), [floor])
  const [camPos, setCamPos] = useState<THREE.Vector3 | null>(null)
  const W = scene.room.w; const D = scene.room.d; const U = scene.room.unit

  useFrame(({ camera }) => setCamPos(camera.position.clone()))

  const wallVisible = useCallback((w: { x: number; z: number; nx: number; nz: number }) => {
    if (!camPos) return true
    const wp = gridToWorld({ gx: w.x, gz: w.z }, 0, W, D, U)
    const v = new THREE.Vector3(camPos.x - wp[0], 0, camPos.z - wp[2]).normalize()
    return v.x * w.nx + v.z * w.nz <= 0
  }, [camPos, W, D, U])

  return (<>
    <ambientLight intensity={0.5} />
    <directionalLight position={[4, 7, 5]} intensity={0.65} />
    <directionalLight position={[-2, 3, 1]} intensity={0.25} />
    <hemisphereLight args={["#e8d8c8", "#c8d8e0", 0.3]} />

    {/* Ground */}
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0]}>
      <planeGeometry args={[W * U + 2, D * U + 2]} /><meshStandardMaterial color="#e8e0d8" roughness={0.95} />
    </mesh>

    {/* Floor tiles */}
    {floor.flatMap((row, gz) => row.map((isFloor, gx) => isFloor ? (
      <mesh key={`f-${gx}-${gz}`} position={[gridToWorld({ gx, gz }, 0, W, D, U)[0], -0.01, gridToWorld({ gx, gz }, 0, W, D, U)[2]]}>
        <boxGeometry args={[U - 0.02, 0.02, U - 0.02]} /><meshStandardMaterial color="#ede8e2" roughness={0.9} />
      </mesh>
    ) : null))}

    {/* Walls with auto-hide */}
    {walls.map((w, i) => {
      if (!wallVisible(w)) return null
      const TH = 0.08; const p = gridToWorld({ gx: w.x, gz: w.z }, 0, W, D, U)
      return (
        <mesh key={i} position={[p[0] + w.nx * (U / 2 + TH / 2), 1.5, p[2] + w.nz * (U / 2 + TH / 2)]}>
          <boxGeometry args={[w.nx !== 0 ? TH : U, 3, w.nz !== 0 ? TH : U]} /><meshStandardMaterial color="#faf6f0" roughness={0.8} />
        </mesh>
      )
    })}

    {/* Furniture */}
    {scene.items.map((item, i) => {
      const def = FURNI.find(f => f.id === item.id)
      if (!def) return null
      return (
        <group key={i} position={[0, item.ty ?? 0, 0]}>
          <Furniture gx={item.gx} gz={item.gz} rotation={item.rotation}>
            {def.render({ gx: item.gx, gz: item.gz })}
          </Furniture>
        </group>
      )
    })}
  </>)
}
