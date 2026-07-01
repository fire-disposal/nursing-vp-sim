import { useRef, useState } from "react"
import { Canvas, useFrame } from "@react-three/fiber"
import { ContactShadows, Float, Html, OrbitControls } from "@react-three/drei"
import * as THREE from "three"
import type { SceneProps } from "../scene-types"
import { R3FErrorBoundary } from "../components/R3FErrorBoundary"
import { SceneTools } from "../components/SceneTools"
import { RoomWalls } from "../components/AutoHideWall"
import { Interactive3D } from "../components/Interactive3D"
import { GRID, gridToWorld } from "../components/GridConfig"

const C = {
  floor: "#f0e6d8", wall: "#faf6f0", wood: "#d4b898", darkW: "#b89a78",
  metal: "#c8c8d0", sheet: "#e4eef4", blanket: "#b8d4c8", skin: "#f0c8a0",
  hair: "#8a7a6a", mon: "#6a8aaa", screen: "#1a2a3a", glow: "#5ab8da",
  plant: "#7aaa6a", pot: "#c87a5a", lampshade: "#f0e0b8",
  cabinet: "#b8a888", chair: "#c8b8a0", rug: "#d4c8b8", accent: "#f5e1da",
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

// ── Chibi Patient ──
function ChibiPatient() {
  const body = useRef<THREE.Group>(null)
  useFrame((s) => { if (body.current) body.current.position.y = 0.22 + Math.sin(s.clock.elapsedTime * 1.8) * 0.005 })
  return (
    <Interactive3D label="患者">
      <group ref={body} position={gridToWorld({ gx: 6, gz: 4 }, 0)}>
        <Box pos={[0.35, 0.05, 0]} size={[0.5, 0.06, 0.6]} color={C.sheet} />
        <Box pos={[-0.15, 0.1, 0]} size={[1.2, 0.16, 0.55]} color={C.blanket} />
        <Sph pos={[0.55, 0.35, 0]} args={[0.16, 20, 20]} color={C.skin} />
        <Sph pos={[0.55, 0.44, 0]} args={[0.17, 20, 20, 0, Math.PI * 2, 0, Math.PI / 2.5]} color={C.hair} />
        <Sph pos={[0.59, 0.36, -0.08]} args={[0.025, 8, 8]} color="#333" />
        <Sph pos={[0.59, 0.36, 0.08]} args={[0.025, 8, 8]} color="#333" />
        <Sph pos={[0.62, 0.33, -0.11]} args={[0.025, 8, 8]} color="#e8a0a0" />
        <Sph pos={[0.62, 0.33, 0.11]} args={[0.025, 8, 8]} color="#e8a0a0" />
      </group>
    </Interactive3D>
  )
}

// ── Bed ──
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

// ── Bedside Table ──
function BedsideTable() {
  return (<group position={gridToWorld({gx:9,gz:3},0)}>
    <Box pos={[0,0.3,0]} size={[0.5,0.6,0.5]} color={C.wood} />
    <Box pos={[0,0.04,0]} size={[0.55,0.08,0.55]} color={C.darkW} />
    <Cyl pos={[0,0.7,0]} args={[0.03,0.05,0.02]} color={C.metal} />
    <Cyl pos={[0,0.85,0]} args={[0.04,0.04,0.3]} color={C.metal} />
    <Cyl pos={[0,1.05,0]} args={[0.15,0.08,0.15]} color={C.lampshade} />
    <Sph pos={[0,0.95,0]} args={[0.05,8,8]} color="#f0d878" />
  </group>)
}

// ── IV Stand ──
function IVStand() {
  return (<Interactive3D label="输液架"><group position={gridToWorld({gx:11,gz:7},0)}>
    <Cyl pos={[0,1.0,0]} args={[0.025,0.025,2.0]} color={C.metal} />
    <Cyl pos={[0,-0.02,0]} args={[0.2,0.25,0.03]} color={C.metal} />
    <Box pos={[0.15,1.0,0]} size={[0.12,0.18,0.04]} color="#e0e8f0" />
    <Cyl pos={[0.15,0.9,0]} args={[0.005,0.005,0.15]} color="#ccc" />
  </group></Interactive3D>)
}

// ── Monitor ──
function Monitor() {
  return (<Interactive3D label="监护仪"><group position={gridToWorld({gx:7,gz:10},0)}>
    <Cyl pos={[0,0.25,0]} args={[0.025,0.04,0.5]} color={C.mon} />
    <Box pos={[0,0.42,0.05]} size={[0.35,0.12,0.03]} color={C.screen} />
    <Box pos={[0,0.42,0]} size={[0.38,0.15,0.02]} color={C.mon} />
  </group></Interactive3D>)
}

// ── Chair ──
function Chair() {
  return (<group position={gridToWorld({gx:3,gz:8},0)}>
    <Box pos={[0,0.3,0]} size={[0.5,0.06,0.5]} color={C.chair} />
    <Box pos={[-0.25,0.55,0]} size={[0.04,0.5,0.5]} color={C.wood} />
    {[[-0.2,0.02,-0.2],[-0.2,0.02,0.2],[0.2,0.02,-0.2],[0.2,0.02,0.2]].map((p,i) => (
      <Cyl key={i} pos={[p[0],p[1],p[2]]} args={[0.025,0.025,0.28]} color={C.darkW} />
    ))}
  </group>)
}

// ── Cabinet ──
function Cabinet() {
  return (<group position={gridToWorld({gx:12,gz:10},0)}>
    <Box pos={[0,0.4,0]} size={[0.6,0.8,0.5]} color={C.cabinet} />
    <Box pos={[0,0.04,0]} size={[0.65,0.08,0.55]} color={C.darkW} />
    <Box pos={[0,0.4,0.255]} size={[0.5,0.6,0.01]} color={C.darkW} />
    <Box pos={[0.15,0.4,0.265]} size={[0.02,0.06,0.02]} color={C.metal} />
  </group>)
}

// ── Plant ──
function Plant() {
  return (<group position={gridToWorld({gx:1,gz:10},0)}>
    <Cyl pos={[0,0.15,0]} args={[0.12,0.1,0.15]} color={C.pot} />
    {[[0,0.35,0],[-0.06,0.3,-0.04],[0.06,0.28,0.04],[-0.04,0.32,0.06],[0.05,0.3,-0.05]].map((p,i) => (
      <Sph key={i} pos={[p[0],p[1],p[2]]} args={[0.05,8,8]} color={C.plant} />
    ))}
  </group>)
}

// ── Wall Clock ──
function WallClock() {
  return (<group position={[-1.5,2.2,-(GRID.D/2)+0.06]}>
    <Cyl pos={[0,0,0]} args={[0.12,0.12,0.02]} color="#f0f0e8" />
    <Box pos={[0.04,0.03,0.015]} size={[0.08,0.01,0.01]} color="#555" />
    <Box pos={[-0.01,0.05,0.015]} size={[0.01,0.1,0.01]} color="#555" />
  </group>)
}

// ── Rug ──
function Rug() {
  return (<mesh rotation={[-Math.PI/2,0,0]} position={gridToWorld({gx:6,gz:6},0)}>
    <planeGeometry args={[1.8,1.4]} />
    <meshStandardMaterial color={C.rug} transparent opacity={0.25} roughness={1} />
  </mesh>)
}

// ── Scene ──
function Scene3D() {
  return (<>
    <mesh rotation={[-Math.PI/2,0,0]} position={[0,-0.002,0]} receiveShadow>
      <planeGeometry args={[GRID.W-0.06, GRID.D-0.06]} />
      <meshStandardMaterial color={C.floor} roughness={0.95} polygonOffset polygonOffsetFactor={-1} polygonOffsetUnits={-1} />
    </mesh>
    <Box pos={[0,0.04,-(GRID.D/2)+0.02]} size={[GRID.W,0.08,0.04]} color={C.wood} />
    <RoomWalls color={C.wall} />
    <Bed /><BedsideTable /><ChibiPatient /><IVStand /><Monitor /><Chair /><Cabinet /><Plant /><WallClock /><Rug />
    <ContactShadows position={[0,0.001,0]} opacity={0.2} scale={7} blur={3} far={3} />
  </>)
}

// ── Exported ──
export default function Demo3D(_props: SceneProps) {
  const orbitRef = useRef<any>(null)

  return (
    <R3FErrorBoundary>
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
          <OrbitControls ref={orbitRef} enableRotate enableZoom enablePan zoomSpeed={0.8} panSpeed={0.4} minZoom={20} maxZoom={120} minPolarAngle={1.1} maxPolarAngle={1.1} target={[0,0.4,0]} />
          <SceneTools controlsRef={orbitRef} />
        </Canvas>
      </div>
    </R3FErrorBoundary>
  )
}
