import { type ReactNode, useLayoutEffect, useRef, useState } from "react"
import { useFrame } from "@react-three/fiber"
import { Html, useCursor } from "@react-three/drei"
import * as THREE from "three"

type IState = "idle" | "hover" | "active"

interface Interactive3DProps {
  children: ReactNode
  label: string
  onInteract?: () => void
}

const COLORS: Record<IState, string> = { idle: "#000", hover: "#5ac8fa", active: "#40a0ff" }

function findFirstMesh(root: THREE.Object3D): THREE.Mesh | null {
  let result: THREE.Mesh | null = null
  root.traverse((child) => { if (child instanceof THREE.Mesh && !result) result = child })
  return result
}

/**
 * Wraps R3F children (meshes, groups) with:
 *  - Pointer cursor on hover
 *  - Outline glow on the first child mesh
 *  - Emissive pulse on hover/active
 *  - Html tooltip
 */
export function Interactive3D({ children, label, onInteract }: Interactive3DProps) {
  const groupRef = useRef<THREE.Group>(null)
  const edgesRef = useRef<THREE.LineSegments>(null)
  const pulse = useRef(0)
  const [state, setState] = useState<IState>("idle")

  useCursor(state !== "idle")

  // Extract EdgesGeometry from the first child Mesh after R3F reconciliation
  useLayoutEffect(() => {
    const root = groupRef.current
    if (!root || edgesRef.current) return

    const mesh = findFirstMesh(root)
    if (!mesh) return

    const geom = new THREE.EdgesGeometry(mesh.geometry, 30)
    const mat = new THREE.LineBasicMaterial({
      transparent: true,
      opacity: 0,
      depthTest: false,
      color: COLORS.hover,
    })
    const lines = new THREE.LineSegments(geom, mat)
    lines.renderOrder = 999
    root.add(lines)
    edgesRef.current = lines
  }, [children])

  useFrame((_, delta) => {
    pulse.current += delta * 3
    const intensity = state === "hover"
      ? 0.12 + Math.sin(pulse.current) * 0.06
      : state === "active"
        ? 0.25 + Math.sin(pulse.current * 2) * 0.12
        : 0

    if (edgesRef.current) {
      const mat = edgesRef.current.material as THREE.LineBasicMaterial
      const c = new THREE.Color(COLORS[state])
      mat.color = c
      mat.opacity = state === "idle" ? 0 : Math.min(1, 0.35 + intensity * 1.5)
    }

    // Emissive pulse on all child meshes
    const root = groupRef.current
    if (!root) return
    root.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        const m = child.material as THREE.MeshStandardMaterial
        if (m && "emissive" in m) {
          m.emissive = new THREE.Color(COLORS[state])
          m.emissiveIntensity = intensity
        }
      }
    })
  })

  return (
    <group
      ref={groupRef}
      onClick={(e) => { e.stopPropagation(); setState("active"); onInteract?.() }}
      onPointerOver={(e) => { e.stopPropagation(); setState("hover") }}
      onPointerOut={() => setState("idle")}
    >
      {children}

      {(state === "hover" || state === "active") && (
        <Html position={[0, 0.9, 0]} center style={{ pointerEvents: "none" }}>
          <div style={{
            background: state === "active" ? COLORS.active : "#333",
            color: "#fff", padding: "3px 10px", borderRadius: 6,
            fontSize: 12, fontFamily: "system-ui", whiteSpace: "nowrap",
            pointerEvents: "none",
          }}>
            {label}{state === "active" ? " ✓" : ""}
          </div>
        </Html>
      )}
    </group>
  )
}
