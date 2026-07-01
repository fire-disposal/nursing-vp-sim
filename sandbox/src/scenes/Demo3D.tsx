import { createContext, useCallback, useContext, useRef, useState } from "react"
import { Canvas, useFrame } from "@react-three/fiber"
import { ContactShadows, Float, Html, OrbitControls } from "@react-three/drei"
import * as THREE from "three"
import { emitSceneEvent, type SceneProps, type SceneState } from "../scene-types"
import { R3FErrorBoundary } from "../components/R3FErrorBoundary"
import { SceneTools } from "../components/SceneTools"
import { RoomWalls } from "../components/AutoHideWall"
import { Interactive3D } from "../components/Interactive3D"
import { GRID, gridToWorld } from "../components/GridConfig"

// ── Palette ──
const C = {
  floor:    "#f0e6d8", wall:  "#faf6f0",
  wood:     "#d4b898", darkW: "#b89a78",
  metal:    "#c8c8d0", sheet: "#e4eef4",
  blanket:  "#b8d4c8", skin:  "#f0c8a0",
  hair:     "#8a7a6a", mon:   "#6a8aaa",
  screen:   "#1a2a3a", glow:  "#5ab8da",
  plant:    "#7aaa6a", pot:   "#c87a5a",
  lamp:     "#f0d878", shade: "#f0e0b8",
  cabinet:  "#b8a888", chair: "#c8b8a0",
  rug:      "#d4c8b8", acc:   "#f5e1da",
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

// ── State-machine context ──
interface StepDef { id: string; label: string; target: string; state?: Partial<SceneState> }
const STEPS: StepDef[] = [
  { id: "observe", label: "观察患者面色", target: "patient", state: { patient: { expression: "pale" as const, consciousness: "alert" as const } } },
  { id: "adjust",  label: "调整患者体位", target: "bed",     state: { patient: { position: "semi-recumbent" as const } } },
  { id: "monitor", label: "查看监护数据", target: "monitor", state: { vitals: { hr: 102, bp_sys: 130, bp_dia: 85, spo2: 96 } } },
  { id: "iv",      label: "检查输液状态", target: "iv",      state: { vitals: { hr: 90 } } },
]
interface StepCtx { step: number; done: boolean; interact: (target: string) => void }
const StepCtx = createContext<StepCtx>({ step: 0, done: false, interact: () => {} })

// ── Wraps Interactive3D with step highlighting ──
function StepTarget({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  const { step, done, interact } = useContext(StepCtx)
  const isTarget = !done && STEPS[step]?.target === id
  return (
    <Interactive3D label={label} onInteract={() => interact(id)}>
      {children}
      {/* Guide arrow for current target */}
      {isTarget && (
        <Float speed={2} rotationIntensity={0} floatIntensity={0.15}>
          <Html position={[0, 1.2, 0]} center pointerEvents="none" transform={false}>
            <div style={{ fontSize: 10 }}>
              👆
            </div>
          </Html>
        </Float>
      )}
    </Interactive3D>
  )
}

// ── Furniture ──

function Bed() {
  const pos = gridToWorld({ gx: 6, gz: 3 }, 0)
  return (
    <group position={pos}>
      <Box pos={[0, 0.04, 0]} size={[2.4, 0.08, 1.4]} color={C.wood} />
      <Box pos={[0, 0.12, 0]} size={[2.2, 0.12, 1.2]} color={C.sheet} />
      <Box pos={[1.15, 0.3, 0]} size={[0.06, 0.5, 1.4]} color={C.wood} />
      {[[-1.0, -0.2, -0.55],[-1.0,-0.2,0.55],[1.0,-0.2,-0.55],[1.0,-0.2,0.55]].map((p,i) => (
        <Cyl key={i} pos={[p[0],p[1],p[2]]} args={[0.03,0.04,0.2]} color={C.darkW} />
      ))}
    </group>
  )
}

function ChibiPatient() {
  const body = useRef<THREE.Group>(null)
  useFrame((s) => { if (body.current) body.current.position.y = 0.22 + Math.sin(s.clock.elapsedTime * 1.8) * 0.005 })
  const pos = gridToWorld({ gx: 6, gz: 3 }, 0)
  return (
    <StepTarget id="patient" label="患者">
      <group ref={body} position={pos}>
        <Box pos={[0.35, 0.05, 0]} size={[0.5, 0.06, 0.6]} color={C.sheet} />
        <Box pos={[-0.15, 0.1, 0]} size={[1.2, 0.16, 0.55]} color={C.blanket} />
        <Sph pos={[0.55, 0.35, 0]} args={[0.16, 20, 20]} color={C.skin} />
        <Sph pos={[0.55, 0.44, 0]} args={[0.17,20,20,0,Math.PI*2,0,Math.PI/2.5]} color={C.hair} />
        <Sph pos={[0.59, 0.36, -0.08]} args={[0.025,8,8]} color="#333" />
        <Sph pos={[0.59, 0.36, 0.08]}  args={[0.025,8,8]} color="#333" />
        <Sph pos={[0.62, 0.33, -0.11]} args={[0.025,8,8]} color="#e8a0a0" />
        <Sph pos={[0.62, 0.33, 0.11]}  args={[0.025,8,8]} color="#e8a0a0" />
      </group>
    </StepTarget>
  )
}

function BedsideTable() {
  return (<group position={gridToWorld({gx:9,gz:3},0)}>
    <Box pos={[0,0.3,0]} size={[0.5,0.6,0.5]} color={C.wood} />
    <Box pos={[0,0.04,0]} size={[0.55,0.08,0.55]} color={C.darkW} />
    <Cyl pos={[0,0.7,0]} args={[0.03,0.05,0.02]} color={C.metal} />
    <Cyl pos={[0,0.85,0]} args={[0.04,0.04,0.3]} color={C.metal} />
    <Cyl pos={[0,1.05,0]} args={[0.15,0.08,0.15]} color={C.shade} />
    <Sph pos={[0,0.95,0]} args={[0.05,8,8]} color={C.lamp} />
    <mesh position={[0,0.6,0]} rotation={[Math.PI,0,0]}>
      <coneGeometry args={[0.3,0.5,8]} />
      <meshBasicMaterial color={C.lamp} transparent opacity={0.05} />
    </mesh>
  </group>)
}

function IVStand() {
  return (<StepTarget id="iv" label="输液架"><group position={gridToWorld({gx:11,gz:7},0)}>
    <Cyl pos={[0,1.0,0]} args={[0.025,0.025,2.0]} color={C.metal} />
    <Cyl pos={[0,-0.02,0]} args={[0.2,0.25,0.03]} color={C.metal} />
    <Box pos={[0.15,1.0,0]} size={[0.12,0.18,0.04]} color="#e0e8f0" />
    <Cyl pos={[0.15,0.9,0]} args={[0.005,0.005,0.15]} color="#ccc" />
  </group></StepTarget>)
}

function Monitor() {
  return (<StepTarget id="monitor" label="监护仪"><group position={gridToWorld({gx:7,gz:10},0)}>
    <Cyl pos={[0,0.25,0]} args={[0.025,0.04,0.5]} color={C.mon} />
    <Box pos={[0,0.42,0.05]} size={[0.35,0.12,0.03]} color={C.screen} />
    <mesh position={[0,0.42,0.065]}>
      <planeGeometry args={[0.28,0.08]} />
      <meshBasicMaterial color={C.glow} transparent opacity={0.15} />
    </mesh>
    <Box pos={[0,0.42,0]} size={[0.38,0.15,0.02]} color={C.mon} />
  </group></StepTarget>)
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

function Cabinet() {
  return (<group position={gridToWorld({gx:12,gz:10},0)}>
    <Box pos={[0,0.4,0]} size={[0.6,0.8,0.5]} color={C.cabinet} />
    <Box pos={[0,0.04,0]} size={[0.65,0.08,0.55]} color={C.darkW} />
    <Box pos={[0,0.4,0.255]} size={[0.5,0.6,0.01]} color={C.darkW} />
    <Box pos={[0.15,0.4,0.265]} size={[0.02,0.06,0.02]} color={C.metal} />
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

function WallClock() {
  return (<group position={[-1.5,2.2,-(GRID.D/2)+0.06]}>
    <Cyl pos={[0,0,0]} args={[0.12,0.12,0.02]} color="#f0f0e8" />
    <Box pos={[0.04,0.03,0.015]} size={[0.08,0.01,0.01]} color="#555" />
    <Box pos={[-0.01,0.05,0.015]} size={[0.01,0.1,0.01]} color="#555" />
  </group>)
}

function Rug() {
  return (<mesh rotation={[-Math.PI/2,0,0]} position={gridToWorld({gx:6,gz:6},0)}>
    <planeGeometry args={[1.8,1.4]} />
    <meshStandardMaterial color={C.rug} transparent opacity={0.25} roughness={1} />
  </mesh>)
}

// ── 3D scene ──
function Scene3D() {
  return (<>
    {/* Floor — polygonOffset prevents z-fighting with wall bottoms */}
    <mesh rotation={[-Math.PI/2,0,0]} position={[0,-0.002,0]} receiveShadow>
      <planeGeometry args={[GRID.W-0.06, GRID.D-0.06]} />
      <meshStandardMaterial color={C.floor} roughness={0.95} polygonOffset polygonOffsetFactor={-1} polygonOffsetUnits={-1} />
    </mesh>
    <Box pos={[0,0.04,-(GRID.D/2)+0.02]} size={[GRID.W,0.08,0.04]} color={C.wood} />
    <RoomWalls color={C.wall} />
    <Bed />
    <ChibiPatient />
    <BedsideTable />
    <IVStand />
    <Monitor />
    <Chair />
    <Cabinet />
    <Plant />
    <WallClock />
    <Rug />
            <ContactShadows position={[0,0.001,0]} opacity={0.2} scale={7} blur={3} far={3} />
  </>)
}

// ── Step guide overlay (rendered outside Canvas) ──
function StepGuide({ step, done }: { step: number; done: boolean }) {
  return (
    <div style={{
      position: "absolute", bottom: 20, left: "50%", transform: "translateX(-50%)",
      display: "flex", gap: 8, background: "#1a1a2edd", padding: "10px 20px",
      borderRadius: 24, backdropFilter: "blur(6px)", fontFamily: "system-ui", zIndex: 10,
    }}>
      {STEPS.map((s, i) => {
        const active = i === step && !done
        const complete = i < step || done
        return (
          <div key={s.id} style={{
            display: "flex", alignItems: "center", gap: 6,
            color: complete ? "#4fc3f7" : active ? "#fff" : "#555",
            fontSize: 13, fontWeight: active ? 600 : 400,
            transition: "all 0.3s",
          }}>
            <span style={{
              width: 22, height: 22, borderRadius: "50%",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 11, fontWeight: 700,
              background: complete ? "#4fc3f7" : active ? "#4fc3f744" : "#333",
              color: complete ? "#111" : active ? "#4fc3f7" : "#555",
            }}>{complete ? "✓" : i + 1}</span>
            {s.label}
            {i < STEPS.length - 1 && (
              <span style={{ color: complete ? "#4fc3f744" : "#333", marginLeft: 2 }}>→</span>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── Completion overlay ──
function CompletionOverlay({ onReset }: { onReset: () => void }) {
  return (
    <div style={{
      position: "absolute", inset: 0, zIndex: 20,
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      background: "rgba(0,0,0,0.4)", backdropFilter: "blur(4px)",
      fontFamily: "system-ui",
    }}>
      <div style={{ fontSize: 48, marginBottom: 12 }}>✅</div>
      <div style={{ color: "#fff", fontSize: 20, fontWeight: 700, marginBottom: 4 }}>场景完成</div>
      <div style={{ color: "#aaa", fontSize: 14, marginBottom: 20 }}>所有步骤已完成</div>
      <button onClick={onReset} style={{
        padding: "8px 24px", background: "#4fc3f7", border: "none",
        borderRadius: 20, color: "#111", fontSize: 14, fontWeight: 600,
        cursor: "pointer",
      }}>重新开始</button>
    </div>
  )
}

// ── Exported component ──
export default function Demo3D({ bus }: SceneProps) {
  const orbitRef = useRef<any>(null)
  const [step, setStep] = useState(0)
  const [done, setDone] = useState(false)
  const [key, setKey] = useState(0)

  const interact = useCallback((target: string) => {
    if (done) return
    const current = STEPS[step]
    if (current?.target === target) {
      emitSceneEvent(bus, "scene:state", STEPS[step].state as Partial<SceneState>)
      emitSceneEvent(bus, "scene:interaction", { hotspotId: target })
      if (step >= STEPS.length - 1) {
        setDone(true)
      } else {
        setStep((s) => s + 1)
      }
    }
  }, [step, done, bus])

  const reset = useCallback(() => {
    setStep(0); setDone(false); setKey((k) => k + 1)
  }, [])

  return (
    <StepCtx.Provider value={{ step, done, interact }}>
      {/* Landscape container */}
      <div style={{ position: "relative", width: "100%", maxWidth: 720, minHeight: 340, aspectRatio: "16/9", margin: "0 auto" }}>
        <R3FErrorBoundary>
          <Canvas
            key={key}
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
        </R3FErrorBoundary>
        {!done && <StepGuide step={step} done={done} />}
        {done && <CompletionOverlay onReset={reset} />}
      </div>
    </StepCtx.Provider>
  )
}
