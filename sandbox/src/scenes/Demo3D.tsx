import { createContext, useContext, type ReactNode, useEffect, useMemo, useRef, useState } from "react"
import { Canvas, useFrame } from "@react-three/fiber"
import { ContactShadows, Html, OrbitControls, useCursor } from "@react-three/drei"
import { ProceduralRoom } from "../components/ProceduralRoom"
import { Furniture } from "../components/Furniture"
import * as THREE from "three"
import type { SceneProps } from "../scene-types"
import { GRID } from "../components/GridConfig"

// ── Shared hover context ──
interface HoverCtx { label: string; pos: [number, number, number] }
const HoverContext = createContext<{
  hover: HoverCtx | null; setHover: (h: HoverCtx | null) => void
  selected: string | null; setSelected: (s: string | null) => void
}>({ hover: null, setHover: () => {}, selected: null, setSelected: () => {} })

// ── Clickable with cursor-following tooltip ──
function Clickable({ label, children }: { label: string; children: ReactNode }) {
  const { setHover, selected, setSelected } = useContext(HoverContext)
  const [h, setH] = useState(false)
  const sel = selected === label
  useCursor(h || sel)
  const ref = useRef<THREE.Group>(null)

  useFrame(() => {
    if (!ref.current) return
    const intensity = h ? 0.35 + Math.sin(performance.now() / 250) * 0.1 : sel ? 0.2 : 0
    ref.current.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        const m = child.material as THREE.MeshStandardMaterial
        if (m && "emissive" in m) {
          m.emissive = new THREE.Color(h ? "#5ac8fa" : sel ? "#40a0ff" : "#000")
          m.emissiveIntensity = intensity
        }
      }
    })
  })

  return (
    <group ref={ref}
      onClick={(e) => { e.stopPropagation(); setSelected(sel ? null : label) }}
      onPointerOver={(e) => { e.stopPropagation(); setH(true); setHover({ label, pos: [e.point.x, e.point.y, e.point.z] }) }}
      onPointerMove={(e) => { if (h) setHover({ label, pos: [e.point.x, e.point.y, e.point.z] }) }}
      onPointerOut={() => { setH(false); setHover(null) }}
    >
      {children}
    </group>
  )
}

function FloatingTooltip() {
  const { hover } = useContext(HoverContext)
  if (!hover) return null
  return (
    <Html position={hover.pos} center transform={false} style={{ pointerEvents: "none" }}>
      <div style={{
        background: "#222e", color: "#fff", padding: "2px 8px", borderRadius: 5,
        fontSize: 10, fontFamily: "system-ui", whiteSpace: "nowrap",
        backdropFilter: "blur(6px)", border: "1px solid #fff3",
        transform: "translate(6px, -6px)",
      }}>{hover.label}</div>
    </Html>
  )
}

// ── Primitive helpers ──
function Box({ pos, size, color, rough = 0.7, ...r }: any) {
  return <mesh position={pos} receiveShadow castShadow {...r}>
    <boxGeometry args={size} /><meshStandardMaterial color={color} roughness={rough} />
  </mesh>
}
function Cyl({ pos, args, color, rough = 0.5, ...r }: any) {
  return <mesh position={pos} receiveShadow castShadow {...r}>
    <cylinderGeometry args={args} /><meshStandardMaterial color={color} roughness={rough} />
  </mesh>
}
function Sph({ pos, args, color, ...r }: any) {
  return <mesh position={pos} castShadow {...r}>
    <sphereGeometry args={args} /><meshStandardMaterial color={color} roughness={0.6} />
  </mesh>
}

// ── Furniture definitions (grid‑aligned) ──
function HospitalBed() {
  return (
    <Furniture gx={6} gz={3} rotation={0}>
      <Box pos={[0, 0.04, 0]} size={[2.4, 0.08, 1.4]} color="#d4b898" />
      <Box pos={[0, 0.12, 0]} size={[2.2, 0.12, 1.2]} color="#e4eef4" />
      <Box pos={[1.15, 0.3, 0]} size={[0.06, 0.5, 1.4]} color="#d4b898" />
      {[[-1.0,-0.2,-0.55],[-1.0,-0.2,0.55],[1.0,-0.2,-0.55],[1.0,-0.2,0.55]].map((p,i) => (
        <Cyl key={i} pos={[p[0],p[1],p[2]]} args={[0.03,0.04,0.2]} color="#b89a78" />
      ))}
    </Furniture>
  )
}

function ChibiPatient() {
  const ref = useRef<THREE.Group>(null)
  useFrame((s) => { if (ref.current) ref.current.position.y = 0.22 + Math.sin(s.clock.elapsedTime * 1.8) * 0.005 })
  return (
    <Clickable label="患者">
      <Furniture gx={6} gz={4}>
        <group ref={ref}>
          <Box pos={[0.35, 0.05, 0]} size={[0.5, 0.06, 0.6]} color="#e4eef4" />
          <Box pos={[-0.15, 0.1, 0]} size={[1.2, 0.16, 0.55]} color="#b8d4c8" />
          <Sph pos={[0.55, 0.35, 0]} args={[0.16, 20, 20]} color="#f0c8a0" />
          <Sph pos={[0.55, 0.44, 0]} args={[0.17,20,20,0,Math.PI*2,0,Math.PI/2.5]} color="#8a7a6a" />
        </group>
      </Furniture>
    </Clickable>
  )
}

function IVStand() {
  return (
    <Clickable label="输液架">
      <Furniture gx={11} gz={7}>
        <Cyl pos={[0,1.0,0]} args={[0.025,0.025,2.0]} color="#c8c8d0" />
        <Cyl pos={[0,-0.02,0]} args={[0.2,0.25,0.03]} color="#c8c8d0" />
        <Box pos={[0.15,1.0,0]} size={[0.12,0.18,0.04]} color="#e0e8f0" />
      </Furniture>
    </Clickable>
  )
}

function Monitor() {
  return (
    <Clickable label="监护仪">
      <Furniture gx={7} gz={10}>
        <Cyl pos={[0,0.25,0]} args={[0.025,0.04,0.5]} color="#6a8aaa" />
        <Box pos={[0,0.42,0.05]} size={[0.35,0.12,0.03]} color="#1a2a3a" />
        <Box pos={[0,0.42,0]} size={[0.38,0.15,0.02]} color="#6a8aaa" />
      </Furniture>
    </Clickable>
  )
}

function Chair() {
  return (
    <Furniture gx={3} gz={8} rotation={180}>
      <Box pos={[0,0.3,0]} size={[0.5,0.06,0.5]} color="#c8b8a0" />
      <Box pos={[-0.25,0.55,0]} size={[0.04,0.5,0.5]} color="#d4b898" />
      {[[-0.2,0.02,-0.2],[-0.2,0.02,0.2],[0.2,0.02,-0.2],[0.2,0.02,0.2]].map((p,i) => (
        <Cyl key={i} pos={[p[0],p[1],p[2]]} args={[0.025,0.025,0.28]} color="#b89a78" />
      ))}
    </Furniture>
  )
}

function Plant() {
  return (
    <Furniture gx={1} gz={10}>
      <Cyl pos={[0,0.15,0]} args={[0.12,0.1,0.15]} color="#c87a5a" />
      {[[0,0.35,0],[-0.06,0.3,-0.04],[0.06,0.28,0.04],[-0.04,0.32,0.06],[0.05,0.3,-0.05]].map((p,i) => (
        <Sph key={i} pos={[p[0],p[1],p[2]]} args={[0.05,8,8]} color="#7aaa6a" />
      ))}
    </Furniture>
  )
}

function Rug() {
  return (
    <Furniture gx={6} gz={6}>
      <mesh rotation={[-Math.PI/2,0,0]} position={[0,0,0]}>
        <planeGeometry args={[1.8,1.4]} />
        <meshStandardMaterial color="#d4c8b8" transparent opacity={0.25} roughness={1} />
      </mesh>
    </Furniture>
  )
}

function Room() {
  const cells = useMemo(() => {
    const c: { gx: number; gz: number }[] = []
    for (let gx = 0; gx < GRID.ROOM_W; gx++)
      for (let gz = 0; gz < GRID.ROOM_D; gz++)
        c.push({ gx, gz })
    return c
  }, [])

  return (<>
    <ProceduralRoom cells={cells} unit={GRID.UNIT} wallHeight={GRID.WALL_H} wallColor="#faf6f0" floorColor="#f0e6d8" />
    <HospitalBed /><ChibiPatient /><IVStand /><Monitor /><Chair /><Plant /><Rug />
    <ContactShadows position={[0,0.001,0]} opacity={0.2} scale={7} blur={3} far={3} />
  </>)
}

export default function Demo3D(_props: SceneProps) {
  const [hover, setHover] = useState<HoverCtx | null>(null)
  const [selected, setSelected] = useState<string | null>(null)

  return (
    <HoverContext.Provider value={{ hover, setHover, selected, setSelected }}>
      <div style={{ position: "relative", width: "100%", maxWidth: 720, minHeight: 340, aspectRatio: "16/9", margin: "0 auto" }}>
        <Canvas orthographic camera={{ position: [6, 5, 7], zoom: 48, near: -10, far: 20 }}
          shadows style={{ width: "100%", height: "100%", background: "#faf6f0", borderRadius: 8 }}
          onCreated={({ gl }) => { gl.setClearColor("#faf6f0") }}
        >
          <ambientLight intensity={0.5} />
          <directionalLight position={[4,7,5]} intensity={0.6} castShadow shadow-mapSize-width={1024} shadow-mapSize-height={1024} shadow-bias={-0.001} />
          <directionalLight position={[-2,3,1]} intensity={0.25} />
          <hemisphereLight args={["#e8d8c8","#c8d8e0",0.3]} />
          <Room />
          <FloatingTooltip />
          <OrbitControls enableRotate enableZoom enablePan zoomSpeed={0.8} panSpeed={0.4} minZoom={20} maxZoom={120} minPolarAngle={1.1} maxPolarAngle={1.1} target={[0,0.4,0]} enableDamping dampingFactor={0.12} />
        </Canvas>
        {selected && (
          <div style={{
            position: "absolute", bottom: 8, left: "50%", transform: "translateX(-50%)",
            background: "#222e", color: "#fff", padding: "3px 12px", borderRadius: 14,
            fontSize: 10, fontFamily: "system-ui", backdropFilter: "blur(6px)",
            border: "1px solid #fff3", pointerEvents: "none",
          }}>
            {selected} <span style={{ color: "#888", fontSize: 9 }}>— click to deselect</span>
          </div>
        )}
      </div>
    </HoverContext.Provider>
  )
}
