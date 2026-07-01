import { createContext, useContext, type ReactNode, useMemo, useRef, useState } from "react"
import { Canvas, useFrame } from "@react-three/fiber"
import { ContactShadows, Html, OrbitControls, useCursor } from "@react-three/drei"
import { ProceduralRoom } from "../components/ProceduralRoom"
import * as THREE from "three"
import type { SceneProps } from "../scene-types"
import { GRID, gridToWorld } from "../components/GridConfig"

const C = {
  floor: "#f0e6d8", wall: "#faf6f0", wood: "#d4b898", darkW: "#b89a78",
  metal: "#c8c8d0", sheet: "#e4eef4", blanket: "#b8d4c8", skin: "#f0c8a0",
  hair: "#8a7a6a", plant: "#7aaa6a", pot: "#c87a5a",
  cabinet: "#b8a888", chair: "#c8b8a0", rug: "#d4c8b8",
}

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

// ── Shared hover state — drives the floating tooltip ──
interface HoverCtx {
  label: string
  pos: [number, number, number]
}

const HoverContext = createContext<{
  hover: HoverCtx | null
  setHover: (h: HoverCtx | null) => void
  selected: string | null
  setSelected: (s: string | null) => void
}>({ hover: null, setHover: () => {}, selected: null, setSelected: () => {} })

// ── Clickable — mesh group with emissive glow + hover events ──
function Clickable({ label, children }: { label: string; children: ReactNode }) {
  const { setHover, selected, setSelected } = useContext(HoverContext)
  const [h, setH] = useState(false)
  const sel = selected === label
  useCursor(h || sel)
  const ref = useRef<THREE.Group>(null)
  const ptRef = useRef<THREE.Vector3>(new THREE.Vector3())

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
      onPointerOver={(e) => { e.stopPropagation(); setH(true); ptRef.current.copy(e.point); setHover({ label, pos: [e.point.x, e.point.y, e.point.z] }) }}
      onPointerMove={(e) => { if (h) { ptRef.current.copy(e.point); setHover({ label, pos: [e.point.x, e.point.y, e.point.z] }) } }}
      onPointerOut={() => { setH(false); setHover(null) }}
    >
      {children}
    </group>
  )
}

// ── Floating tooltip rendered once at Canvas root ──
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
      }}>
        {hover.label}
      </div>
    </Html>
  )
}

// ── Furniture ──
function ChibiPatient() {
  const body = useRef<THREE.Group>(null)
  useFrame((s) => { if (body.current) body.current.position.y = 0.22 + Math.sin(s.clock.elapsedTime * 1.8) * 0.005 })
  return (
    <Clickable label="患者">
      <group ref={body} position={gridToWorld({ gx: 6, gz: 4 }, 0)}>
        <Box pos={[0.35, 0.05, 0]} size={[0.5, 0.06, 0.6]} color={C.sheet} />
        <Box pos={[-0.15, 0.1, 0]} size={[1.2, 0.16, 0.55]} color={C.blanket} />
        <Sph pos={[0.55, 0.35, 0]} args={[0.16, 20, 20]} color={C.skin} />
        <Sph pos={[0.55, 0.44, 0]} args={[0.17, 20, 20, 0, Math.PI * 2, 0, Math.PI / 2.5]} color={C.hair} />
        <Sph pos={[0.59, 0.36, -0.08]} args={[0.025, 8, 8]} color="#333" />
        <Sph pos={[0.59, 0.36, 0.08]} args={[0.025, 8, 8]} color="#333" />
      </group>
    </Clickable>
  )
}

function Bed() {
  const pos = gridToWorld({ gx: 6, gz: 3 }, 0)
  return (<group position={pos}>
    <Box pos={[0, 0.04, 0]} size={[2.4, 0.08, 1.4]} color={C.wood} />
    <Box pos={[0, 0.12, 0]} size={[2.2, 0.12, 1.2]} color={C.sheet} />
    <Box pos={[1.15, 0.3, 0]} size={[0.06, 0.5, 1.4]} color={C.wood} />
    {[[-1.0, -0.2, -0.55],[-1.0,-0.2,0.55],[1.0,-0.2,-0.55],[1.0,-0.2,0.55]].map((p,i) => (
      <Cyl key={i} pos={[p[0],p[1],p[2]]} args={[0.03,0.04,0.2]} color={C.darkW} />
    ))}
  </group>)
}

function IVStand() {
  return (<Clickable label="输液架"><group position={gridToWorld({gx:11,gz:7},0)}>
    <Cyl pos={[0,1.0,0]} args={[0.025,0.025,2.0]} color={C.metal} />
    <Cyl pos={[0,-0.02,0]} args={[0.2,0.25,0.03]} color={C.metal} />
    <Box pos={[0.15,1.0,0]} size={[0.12,0.18,0.04]} color="#e0e8f0" />
  </group></Clickable>)
}

function Monitor() {
  return (<Clickable label="监护仪"><group position={gridToWorld({gx:7,gz:10},0)}>
    <Cyl pos={[0,0.25,0]} args={[0.025,0.04,0.5]} color="#6a8aaa" />
    <Box pos={[0,0.42,0.05]} size={[0.35,0.12,0.03]} color="#1a2a3a" />
    <Box pos={[0,0.42,0]} size={[0.38,0.15,0.02]} color="#6a8aaa" />
  </group></Clickable>)
}

function Chair() {
  return (<group position={gridToWorld({gx:3,gz:8},0)}>
    <Box pos={[0,0.3,0]} size={[0.5,0.06,0.5]} color={C.chair} />
    <Box pos={[-0.25,0.55,0]} size={[0.04,0.5,0.5]} color={C.wood} />
    {[[-0.2,0.02,-0.2],[-0.2,0.02,0.2],[0.2,0.02,-0.2],[0.2,0.02,0.2]].map((p,i) => (
      <Cyl key={i} pos={[p[0],p[1],p[2]]} args={[0.025,0.025,0.28]} color={C.darkW} />
    ))}
  </group>)
}

function Plant() {
  return (<group position={gridToWorld({gx:1,gz:10},0)}>
    <Cyl pos={[0,0.15,0]} args={[0.12,0.1,0.15]} color={C.pot} />
    {[[0,0.35,0],[-0.06,0.3,-0.04],[0.06,0.28,0.04],[-0.04,0.32,0.06],[0.05,0.3,-0.05]].map((p,i) => (
      <Sph key={i} pos={[p[0],p[1],p[2]]} args={[0.05,8,8]} color={C.plant} />
    ))}
  </group>)
}

function Rug() {
  return (<mesh rotation={[-Math.PI/2,0,0]} position={gridToWorld({gx:6,gz:6},0)}>
    <planeGeometry args={[1.8,1.4]} />
    <meshStandardMaterial color={C.rug} transparent opacity={0.25} roughness={1} />
  </mesh>)
}

function ROOM_CELLS() {
  const cells: { gx: number; gz: number }[] = []
  for (let gx = 0; gx < GRID.ROOM_W; gx++)
    for (let gz = 0; gz < GRID.ROOM_D; gz++)
      cells.push({ gx, gz })
  return cells
}

function Scene3D() {
  const cells = useMemo(() => ROOM_CELLS(), [])
  return (<>
    <ProceduralRoom cells={cells} unit={GRID.UNIT} wallHeight={GRID.WALL_H} wallColor={C.wall} floorColor={C.floor} />
    <Bed /><ChibiPatient /><IVStand /><Monitor /><Chair /><Plant /><Rug />
    <ContactShadows position={[0,0.001,0]} opacity={0.2} scale={7} blur={3} far={3} />
  </>)
}

export default function Demo3D(_props: SceneProps) {
  const orbitRef = useRef<any>(null)
  const [hover, setHover] = useState<HoverCtx | null>(null)
  const [selected, setSelected] = useState<string | null>(null)

  return (
    <HoverContext.Provider value={{ hover, setHover, selected, setSelected }}>
      <div style={{ position: "relative", width: "100%", maxWidth: 720, minHeight: 340, aspectRatio: "16/9", margin: "0 auto" }}>
        <Canvas
          orthographic
          camera={{ position: [6, 5, 7], zoom: 48, near: -10, far: 20 }}
          shadows
          style={{ width: "100%", height: "100%", background: C.wall, borderRadius: 8 }}
          onCreated={({ gl }) => { gl.setClearColor(C.wall) }}
        >
          <ambientLight intensity={0.5} />
          <directionalLight position={[4,7,5]} intensity={0.6} castShadow shadow-mapSize-width={1024} shadow-mapSize-height={1024} shadow-bias={-0.001} />
          <directionalLight position={[-2,3,1]} intensity={0.25} />
          <hemisphereLight args={["#e8d8c8","#c8d8e0",0.3]} />
          <Scene3D />
          <FloatingTooltip />
          <OrbitControls ref={orbitRef} enableRotate enableZoom enablePan zoomSpeed={0.8} panSpeed={0.4} minZoom={20} maxZoom={120} minPolarAngle={1.1} maxPolarAngle={1.1} target={[0,0.4,0]} enableDamping dampingFactor={0.12} />
        </Canvas>
        {/* Selection info strip */}
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
