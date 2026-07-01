/**
 * FurnitureLab — preview, tune, and calibrate furniture items.
 *
 * Supports both primitive‑based and GLB models.
 * Adjust translate (X/Y/Z), rotation (Y), and uniform scale in real‑time.
 */
import { useState } from "react"
import { Canvas } from "@react-three/fiber"
import { ContactShadows, Html, OrbitControls } from "@react-three/drei"
import { type ReactNode } from "react"
import { Furniture } from "../components/Furniture"

// ── Furniture catalogue ──
interface FurniDef {
  id: string; name: string
  /** Initial grid position for preview. */
  gx: number; gz: number
  /** Preview‑only: renders the piece centered on the grid. */
  render: (props: { gx: number; gz: number }) => ReactNode
}

const FURNI: FurniDef[] = [
  {
    id: "bed", name: "病床", gx: 0, gz: 0,
    render: ({ gx, gz }) => (
      <Furniture gx={gx} gz={gz}>
        <mesh position={[0,0.04,0]} receiveShadow castShadow><boxGeometry args={[2.4,0.08,1.4]} /><meshStandardMaterial color="#d4b898" roughness={0.7} /></mesh>
        <mesh position={[0,0.12,0]} receiveShadow castShadow><boxGeometry args={[2.2,0.12,1.2]} /><meshStandardMaterial color="#e4eef4" roughness={0.7} /></mesh>
        <mesh position={[1.15,0.3,0]} receiveShadow castShadow><boxGeometry args={[0.06,0.5,1.4]} /><meshStandardMaterial color="#d4b898" roughness={0.7} /></mesh>
        {[[-1.0,-0.2,-0.55],[-1.0,-0.2,0.55],[1.0,-0.2,-0.55],[1.0,-0.2,0.55]].map((p,i) => (
          <mesh key={i} position={[p[0],p[1],p[2]]} castShadow><cylinderGeometry args={[0.03,0.04,0.2]} /><meshStandardMaterial color="#b89a78" /></mesh>
        ))}
      </Furniture>
    ),
  },
  {
    id: "patient", name: "患者 (chibi)", gx: 0, gz: 0,
    render: ({ gx, gz }) => (
      <Furniture gx={gx} gz={gz}>
        <mesh position={[0.35,0.05,0]} receiveShadow castShadow><boxGeometry args={[0.5,0.06,0.6]} /><meshStandardMaterial color="#e4eef4" /></mesh>
        <mesh position={[-0.15,0.1,0]} receiveShadow castShadow><boxGeometry args={[1.2,0.16,0.55]} /><meshStandardMaterial color="#b8d4c8" /></mesh>
        <mesh position={[0.55,0.35,0]} castShadow><sphereGeometry args={[0.16,20,20]} /><meshStandardMaterial color="#f0c8a0" roughness={0.6} /></mesh>
        <mesh position={[0.55,0.44,0]} castShadow><sphereGeometry args={[0.17,20,20,0,Math.PI*2,0,Math.PI/2.5]} /><meshStandardMaterial color="#8a7a6a" roughness={0.8} /></mesh>
      </Furniture>
    ),
  },
  {
    id: "iv", name: "输液架", gx: 0, gz: 0,
    render: ({ gx, gz }) => (
      <Furniture gx={gx} gz={gz}>
        <mesh position={[0,1.0,0]} castShadow><cylinderGeometry args={[0.025,0.025,2.0]} /><meshStandardMaterial color="#c8c8d0" metalness={0.3} /></mesh>
        <mesh position={[0,-0.02,0]}><cylinderGeometry args={[0.2,0.25,0.03]} /><meshStandardMaterial color="#c8c8d0" metalness={0.3} /></mesh>
        <mesh position={[0.15,1.0,0]} castShadow><boxGeometry args={[0.12,0.18,0.04]} /><meshStandardMaterial color="#e0e8f0" transparent opacity={0.6} /></mesh>
      </Furniture>
    ),
  },
  {
    id: "monitor", name: "监护仪", gx: 0, gz: 0,
    render: ({ gx, gz }) => (
      <Furniture gx={gx} gz={gz}>
        <mesh position={[0,0.25,0]} castShadow><cylinderGeometry args={[0.025,0.04,0.5]} /><meshStandardMaterial color="#6a8aaa" /></mesh>
        <mesh position={[0,0.42,0.05]} castShadow><boxGeometry args={[0.35,0.12,0.03]} /><meshStandardMaterial color="#1a2a3a" /></mesh>
        <mesh position={[0,0.42,0]}><boxGeometry args={[0.38,0.15,0.02]} /><meshStandardMaterial color="#6a8aaa" /></mesh>
      </Furniture>
    ),
  },
  {
    id: "chair", name: "椅子", gx: 0, gz: 0,
    render: ({ gx, gz }) => (
      <Furniture gx={gx} gz={gz}>
        <mesh position={[0,0.3,0]} receiveShadow castShadow><boxGeometry args={[0.5,0.06,0.5]} /><meshStandardMaterial color="#c8b8a0" roughness={0.7} /></mesh>
        <mesh position={[-0.25,0.55,0]} receiveShadow castShadow><boxGeometry args={[0.04,0.5,0.5]} /><meshStandardMaterial color="#d4b898" /></mesh>
        {[[-0.2,0.02,-0.2],[-0.2,0.02,0.2],[0.2,0.02,-0.2],[0.2,0.02,0.2]].map((p,i) => (
          <mesh key={i} position={[p[0],p[1],p[2]]} castShadow><cylinderGeometry args={[0.025,0.025,0.28]} /><meshStandardMaterial color="#b89a78" /></mesh>
        ))}
      </Furniture>
    ),
  },
  {
    id: "plant", name: "盆栽", gx: 0, gz: 0,
    render: ({ gx, gz }) => (
      <Furniture gx={gx} gz={gz}>
        <mesh position={[0,0.15,0]}><cylinderGeometry args={[0.12,0.1,0.15]} /><meshStandardMaterial color="#c87a5a" /></mesh>
        {[[0,0.35,0],[-0.06,0.3,-0.04],[0.06,0.28,0.04],[-0.04,0.32,0.06],[0.05,0.3,-0.05]].map((p,i) => (
          <mesh key={i} position={[p[0],p[1],p[2]]}><sphereGeometry args={[0.05,8,8]} /><meshStandardMaterial color="#7aaa6a" roughness={0.9} /></mesh>
        ))}
      </Furniture>
    ),
  },
]

// ── Preview scene ──
function Preview({ def, tx, ty, tz, rot, sc }: { def: FurniDef; tx: number; ty: number; tz: number; rot: number; sc: number }) {
  return (
    <>
      {/* Grid floor */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]} receiveShadow>
        <planeGeometry args={[4, 4]} />
        <meshStandardMaterial color="#e8e0d8" roughness={0.95} />
      </mesh>
      <gridHelper args={[4, 8, "#ccc", "#aaa"]} position={[0, -0.005, 0]} />

      {/* Furniture with user transforms applied */}
      <group position={[tx, ty, tz]} rotation={[0, rot, 0]} scale={[sc, sc, sc]}>
        {def.render({ gx: 0, gz: 0 })}
      </group>

      <ContactShadows position={[0, 0, 0]} opacity={0.3} scale={5} blur={2} far={2} />
    </>
  )
}

// ── Slider component ──
function Knob({ label, value, min, max, step, onChange, unit }: {
  label: string; value: number; min: number; max: number; step: number
  onChange: (v: number) => void; unit?: string
}) {
  return (
    <div style={{ marginBottom: 6 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#888", marginBottom: 2 }}>
        <span>{label}</span>
        <span style={{ fontVariantNumeric: "tabular-nums" }}>{value.toFixed(step < 0.1 ? 2 : 1)}{unit}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ width: "100%", height: 4, accentColor: "#4fc3f7", cursor: "pointer" }}
      />
    </div>
  )
}

// ── Page ──
export default function FurnitureLab() {
  const [idx, setIdx] = useState(0)
  const [tx, setTx] = useState(0); const [ty, setTy] = useState(0); const [tz, setTz] = useState(0)
  const [rot, setRot] = useState(0); const [sc, setSc] = useState(1)

  const def = FURNI[idx]

  return (
    <div style={{ display: "flex", height: "100%", fontFamily: "system-ui", background: "#1a1a2a" }}>
      {/* 3D viewport */}
      <div style={{ flex: 1, position: "relative" }}>
        <Canvas camera={{ position: [2.5, 2, 3], fov: 35 }} shadows style={{ background: "#e8e0d8" }}>
          <ambientLight intensity={0.5} />
          <directionalLight position={[3,5,3]} intensity={0.7} castShadow shadow-mapSize-width={1024} shadow-mapSize-height={1024} />
          <directionalLight position={[-2,2,1]} intensity={0.3} />
          <hemisphereLight args={["#e8d8c8","#c8d8e0",0.3]} />
          <Preview def={def} tx={tx} ty={ty} tz={tz} rot={rot * Math.PI / 180} sc={sc} />
          <OrbitControls enableZoom enablePan enableRotate minDistance={1} maxDistance={10} target={[0, 0.4, 0]} />
        </Canvas>
        {/* Top bar — floating over canvas */}
        <div style={{
          position: "absolute", top: 8, left: 8, display: "flex", gap: 6, alignItems: "center",
          background: "#1a1a2ecc", padding: "6px 12px", borderRadius: 8, backdropFilter: "blur(6px)",
        }}>
          <span style={{ color: "#888", fontSize: 11, fontWeight: 600 }}>FURNITURE LAB</span>
          <select value={idx} onChange={(e) => setIdx(Number(e.target.value))}
            style={{ padding: "3px 8px", background: "#222", color: "#e0e0e0", border: "1px solid #444", borderRadius: 4, fontSize: 12, cursor: "pointer" }}>
            {FURNI.map((f, i) => <option key={f.id} value={i}>{f.name}</option>)}
          </select>
        </div>
      </div>

      {/* Parameter panel */}
      <div style={{
        width: 260, background: "#12121e", borderLeft: "1px solid #333",
        display: "flex", flexDirection: "column", fontSize: 12, overflow: "auto",
      }}>
        <div style={{ padding: "10px 14px", borderBottom: "1px solid #333", color: "#888", fontWeight: 700, fontSize: 11 }}>
          PARAMETERS — {def.name.toUpperCase()}
        </div>
        <div style={{ padding: "10px 14px", flex: 1 }}>
          <div style={{ marginBottom: 12 }}>
            <div style={{ color: "#666", fontSize: 10, fontWeight: 600, marginBottom: 6 }}>TRANSLATE</div>
            <Knob label="X (左右)" value={tx} min={-2} max={2} step={0.05} onChange={setTx} />
            <Knob label="Y (上下)" value={ty} min={-1} max={2} step={0.05} onChange={setTy} />
            <Knob label="Z (前后)" value={tz} min={-2} max={2} step={0.05} onChange={setTz} />
          </div>
          <div style={{ marginBottom: 12 }}>
            <div style={{ color: "#666", fontSize: 10, fontWeight: 600, marginBottom: 6 }}>ROTATE</div>
            <Knob label="Y 轴旋转" value={rot} min={0} max={360} step={1} onChange={setRot} unit="°" />
          </div>
          <div style={{ marginBottom: 12 }}>
            <div style={{ color: "#666", fontSize: 10, fontWeight: 600, marginBottom: 6 }}>SCALE</div>
            <Knob label="统一缩放" value={sc} min={0.1} max={3} step={0.05} onChange={setSc} />
          </div>
          <div style={{ borderTop: "1px solid #2a2a3e", paddingTop: 10, marginTop: 10 }}>
            <div style={{ color: "#666", fontSize: 10, fontWeight: 600, marginBottom: 6 }}>CURRENT VALUES</div>
            <pre style={{ margin: 0, color: "#aaa", fontSize: 10, whiteSpace: "pre-wrap", fontFamily: "monospace" }}>
{`tx: ${tx.toFixed(2)}
ty: ${ty.toFixed(2)}
tz: ${tz.toFixed(2)}
rot: ${rot}°
scale: ${sc.toFixed(2)}`}
            </pre>
          </div>
        </div>
      </div>
    </div>
  )
}
