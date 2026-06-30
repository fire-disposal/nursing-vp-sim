import { type ReactNode, useRef, useState } from "react"
import { useFrame } from "@react-three/fiber"
import { Html } from "@react-three/drei"
import * as THREE from "three"

type IState = "idle" | "hover" | "active"

interface Interactive3DProps {
  children: ReactNode
  label: string
  onInteract?: () => void
}

const COLORS: Record<IState, string> = { idle: "#000", hover: "#5ac8fa", active: "#40a0ff" }

/**
 * Wraps children with hover/click interaction + emissive glow.
 * Edge outline removed — tracking per‑mesh offset was unreliable.
 */
export function Interactive3D({ children, label, onInteract }: Interactive3DProps) {
  const groupRef = useRef<THREE.Group>(null)
  const pulse = useRef(0)
  const [state, setState] = useState<IState>("idle")

  useFrame((_, delta) => {
    pulse.current += delta * 3
    const intensity = state === "hover"
      ? 0.15 + Math.sin(pulse.current) * 0.06
      : state === "active"
        ? 0.3 + Math.sin(pulse.current * 2) * 0.15
        : 0

    const root = groupRef.current
    if (!root) return
    root.traverse((child) => {
      if (child instanceof THREE.Mesh && child.geometry.type !== "PlaneGeometry") {
        const m = child.material as THREE.MeshStandardMaterial
        if (m && "emissive" in m) {
          m.emissive = new THREE.Color(state === "idle" ? "#000" : "#5ac8fa")
          m.emissiveIntensity = intensity
        }
      }
    })
  })

  const handleClick = () => { setState("active"); onInteract?.() }

  return (
    <group ref={groupRef} onClick={handleClick} onPointerOver={() => setState("hover")} onPointerOut={() => setState("idle")}>
      {children}

      {(state === "hover" || state === "active") && (
        <Html position={[0, 1.2, 0]} center pointerEvents="none" transform={false}>
          <div style={{
            background: state === "active" ? COLORS.active : "#333",
            color: "#fff", padding: "2px 6px", borderRadius: 4,
            fontSize: 10, fontFamily: "system-ui", whiteSpace: "nowrap",
          }}>
            {label}{state === "active" ? " ✓" : ""}
          </div>
        </Html>
      )}
    </group>
  )
}
