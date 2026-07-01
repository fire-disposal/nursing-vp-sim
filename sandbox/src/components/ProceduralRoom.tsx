/**
 * Procedural room — define floor cells, walls auto‑generate
 * along any perimeter edge that lacks a neighbour cell.
 *
 * Wall auto‑hide: each segment hides when the camera is on its
 * outward side (dot product of camera→wall with inward normal > 0).
 */
import { useMemo, useRef } from "react"
import { useFrame } from "@react-three/fiber"
import * as THREE from "three"

export interface Cell { gx: number; gz: number }

interface WallSeg {
  cx: number          // world centre x
  cz: number          // world centre z
  len: number         // length along the wall
  axis: "x" | "z"    // orientation
  inwardX: number     // inward normal x component
  inwardZ: number     // inward normal z component
}

interface RoomConfig {
  cells: Cell[]
  unit: number
  wallHeight: number
  wallColor: string
  floorColor: string
}

/**
 * From a set of grid cells, compute the minimal set of wall segments
 * along the perimeter (edges without a neighbour in the set).
 */
function buildWalls(cells: Cell[], unit: number): WallSeg[] {
  const set = new Set(cells.map((c) => `${c.gx},${c.gz}`))
  const has = (gx: number, gz: number) => set.has(`${gx},${gz}`)
  const wallMap = new Map<string, { axis: "x" | "z"; inwardX: number; inwardZ: number }>()

  for (const c of cells) {
    // Check four cardinal neighbours
    const dirs: [number, number, number, number][] = [
      [0, -1,  0, -1], // down  (‑Z)  → inward normal +Z
      [0,  1,  0,  1], // up    (+Z)  → inward normal -Z
      [-1, 0, -1,  0], // left  (‑X)  → inward normal +X
      [1,  0,  1,  0], // right (+X)  → inward normal -X
    ]
    for (const [dx, dz, nx, nz] of dirs) {
      const ngx = c.gx + dx
      const ngz = c.gz + dz
      if (!has(ngx, ngz)) {
        // Edge at the midpoint between c and ng, with inward normal (nx, nz)
        const mx = (c.gx + ngx) / 2
        const mz = (c.gz + ngz) / 2
        const axis: "x" | "z" = dx !== 0 ? "z" : "x"
        const key = `${mx},${mz},${axis}`
        // Merge: if an adjacent segment on the same axis already exists, skip
        // (we'll merge later)
        if (!wallMap.has(key)) {
          wallMap.set(key, { axis, inwardX: nx, inwardZ: nz })
        }
      }
    }
  }

  // Convert map to list, compute world positions
  const segs: WallSeg[] = []
  for (const [key, meta] of wallMap) {
    const [mx, mz, axis] = key.split(",")
    const gx = Number(mx)
    const gz = Number(mz)
    segs.push({
      cx: (gx - 0.5) * unit,
      cz: (gz - 0.5) * unit,
      len: unit,
      axis: meta.axis as "x" | "z",
      inwardX: meta.inwardX,
      inwardZ: meta.inwardZ,
    })
  }

  // Merge collinear adjacent segments on the same axis
  // Group by (axis, normal), then sort, then merge
  const groups = new Map<string, WallSeg[]>()
  for (const s of segs) {
    const key = `${s.axis},${s.inwardX},${s.inwardZ}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(s)
  }

  const merged: WallSeg[] = []
  for (const [, group] of groups) {
    if (group.length === 0) continue
    const axis = group[0].axis
    // Sort along the axis
    if (axis === "x") {
      group.sort((a, b) => a.cz - b.cz || a.cx - b.cx)
    } else {
      group.sort((a, b) => a.cx - b.cx || a.cz - b.cz)
    }

    let cur = group[0]
    for (let i = 1; i < group.length; i++) {
      const n = group[i]
      const gap = axis === "x" ? n.cx - cur.cx : n.cz - cur.cz
      if (Math.abs(gap) < 0.001) {
        // Same line, extend
        if (axis === "x") {
          const newLen = n.cx - cur.cx + cur.len / 2 + n.len / 2
          cur.len = newLen
        } else {
          const newLen = n.cz - cur.cz + cur.len / 2 + n.len / 2
          cur.len = newLen
        }
      } else {
        merged.push(cur)
        cur = n
      }
    }
    merged.push(cur)
  }

  return merged
}

// ── Wall mesh with auto-hide ──
function WallMesh({ seg, height, color }: { seg: WallSeg; height: number; color: string }) {
  const ref = useRef<THREE.Mesh>(null)
  const normal = useRef(new THREE.Vector3(seg.inwardX, 0, seg.inwardZ).normalize())
  const pos = useRef(new THREE.Vector3(seg.cx, height / 2, seg.cz))

  useFrame(({ camera }) => {
    if (!ref.current) return
    const dir = new THREE.Vector3().copy(camera.position).sub(pos.current).normalize()
    ref.current.visible = dir.dot(normal.current) < 0
  })

  const size: [number, number, number] = seg.axis === "x"
    ? [seg.len, height, 0.06]
    : [0.06, height, seg.len]

  return (
    <mesh ref={ref} position={[seg.cx, height / 2, seg.cz]} receiveShadow>
      <boxGeometry args={size} />
      <meshStandardMaterial color={color} roughness={0.9} side={THREE.DoubleSide} />
    </mesh>
  )
}

// ── Exported component ──
export function ProceduralRoom({ cells, unit, wallHeight, wallColor, floorColor }: RoomConfig) {
  const walls = useMemo(() => buildWalls(cells, unit), [cells, unit])

  // Compute bounding box for floor
  const minX = Math.min(...cells.map((c) => c.gx)) - 0.5
  const maxX = Math.max(...cells.map((c) => c.gx)) + 0.5
  const minZ = Math.min(...cells.map((c) => c.gz)) - 0.5
  const maxZ = Math.max(...cells.map((c) => c.gz)) + 0.5
  const fw = (maxX - minX) * unit
  const fd = (maxZ - minZ) * unit
  const fcx = (minX + maxX) / 2 * unit
  const fcz = (minZ + maxZ) / 2 * unit

  return (
    <>
      {/* Floor at Y=0 — all walls start from Y=0 */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[fcx, 0, fcz]} receiveShadow>
        <planeGeometry args={[fw, fd]} />
        <meshStandardMaterial color={floorColor} roughness={0.95} polygonOffset polygonOffsetFactor={-1} polygonOffsetUnits={-1} />
      </mesh>
      {/* Grid helper slightly below floor */}
      <gridHelper args={[Math.max(fw, fd), Math.round(Math.max(fw, fd) / unit / 2), "#4a4a5e", "#3a3a4e"]} position={[fcx, -0.005, fcz]} />
    </>
  )
}
