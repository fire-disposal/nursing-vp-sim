import type { ReactNode } from "react"

export interface FurniDef {
  id: string; name: string; category: string
  tags: string[]
  thumb: string
  render: (props: { gx: number; gz: number }) => ReactNode
}

export const FURNI: FurniDef[] = [
  { id: "bed", name: "病床", category: "bed", tags: ["床","病房","卧具"], thumb: "#8aaece",
    render: () => (<>
      <mesh position={[0,0.04,0]} receiveShadow castShadow><boxGeometry args={[2.4,0.08,1.4]} /><meshStandardMaterial color="#d4b898" roughness={0.7} /></mesh>
      <mesh position={[0,0.12,0]} receiveShadow castShadow><boxGeometry args={[2.2,0.12,1.2]} /><meshStandardMaterial color="#e4eef4" roughness={0.7} /></mesh>
      <mesh position={[1.15,0.3,0]} receiveShadow castShadow><boxGeometry args={[0.06,0.5,1.4]} /><meshStandardMaterial color="#d4b898" roughness={0.7} /></mesh>
      {[[-1.0,-0.2,-0.55],[-1.0,-0.2,0.55],[1.0,-0.2,-0.55],[1.0,-0.2,0.55]].map((p,i) => (
        <mesh key={i} position={[p[0],p[1],p[2]]} castShadow><cylinderGeometry args={[0.03,0.04,0.2]} /><meshStandardMaterial color="#b89a78" /></mesh>
      ))}
    </>)},
  { id: "patient", name: "患者 (chibi)", category: "character", tags: ["人","患者"], thumb: "#f0c8a0",
    render: () => (<>
      <mesh position={[0.35,0.05,0]} receiveShadow castShadow><boxGeometry args={[0.5,0.06,0.6]} /><meshStandardMaterial color="#e4eef4" /></mesh>
      <mesh position={[-0.15,0.1,0]} receiveShadow castShadow><boxGeometry args={[1.2,0.16,0.55]} /><meshStandardMaterial color="#b8d4c8" /></mesh>
      <mesh position={[0.55,0.35,0]} castShadow><sphereGeometry args={[0.16,20,20]} /><meshStandardMaterial color="#f0c8a0" roughness={0.6} /></mesh>
      <mesh position={[0.55,0.44,0]} castShadow><sphereGeometry args={[0.17,20,20,0,Math.PI*2,0,Math.PI/2.5]} /><meshStandardMaterial color="#8a7a6a" roughness={0.8} /></mesh>
    </>)},
  { id: "iv", name: "输液架", category: "equipment", tags: ["输液","仪器"], thumb: "#c8d0d8",
    render: () => (<>
      <mesh position={[0,1.0,0]} castShadow><cylinderGeometry args={[0.025,0.025,2.0]} /><meshStandardMaterial color="#c8c8d0" metalness={0.3} /></mesh>
      <mesh position={[0,-0.02,0]}><cylinderGeometry args={[0.2,0.25,0.03]} /><meshStandardMaterial color="#c8c8d0" metalness={0.3} /></mesh>
      <mesh position={[0.15,1.0,0]} castShadow><boxGeometry args={[0.12,0.18,0.04]} /><meshStandardMaterial color="#e0e8f0" transparent opacity={0.6} /></mesh>
    </>)},
  { id: "monitor", name: "监护仪", category: "equipment", tags: ["监测","仪器"], thumb: "#6a8aaa",
    render: () => (<>
      <mesh position={[0,0.25,0]} castShadow><cylinderGeometry args={[0.025,0.04,0.5]} /><meshStandardMaterial color="#6a8aaa" /></mesh>
      <mesh position={[0,0.42,0.05]} castShadow><boxGeometry args={[0.35,0.12,0.03]} /><meshStandardMaterial color="#1a2a3a" /></mesh>
      <mesh position={[0,0.42,0]}><boxGeometry args={[0.38,0.15,0.02]} /><meshStandardMaterial color="#6a8aaa" /></mesh>
    </>)},
  { id: "chair", name: "椅子", category: "furniture", tags: ["座位","家具"], thumb: "#c8b8a0",
    render: () => (<>
      <mesh position={[0,0.3,0]} receiveShadow castShadow><boxGeometry args={[0.5,0.06,0.5]} /><meshStandardMaterial color="#c8b8a0" roughness={0.7} /></mesh>
      <mesh position={[-0.25,0.55,0]} receiveShadow castShadow><boxGeometry args={[0.04,0.5,0.5]} /><meshStandardMaterial color="#d4b898" /></mesh>
      {[[-0.2,0.02,-0.2],[-0.2,0.02,0.2],[0.2,0.02,-0.2],[0.2,0.02,0.2]].map((p,i) => (
        <mesh key={i} position={[p[0],p[1],p[2]]} castShadow><cylinderGeometry args={[0.025,0.025,0.28]} /><meshStandardMaterial color="#b89a78" /></mesh>
      ))}
    </>)},
  { id: "plant", name: "盆栽", category: "decor", tags: ["植物","装饰"], thumb: "#7aaa6a",
    render: () => (<>
      <mesh position={[0,0.15,0]}><cylinderGeometry args={[0.12,0.1,0.15]} /><meshStandardMaterial color="#c87a5a" /></mesh>
      {[[0,0.35,0],[-0.06,0.3,-0.04],[0.06,0.28,0.04],[-0.04,0.32,0.06],[0.05,0.3,-0.05]].map((p,i) => (
        <mesh key={i} position={[p[0],p[1],p[2]]}><sphereGeometry args={[0.05,8,8]} /><meshStandardMaterial color="#7aaa6a" roughness={0.9} /></mesh>
      ))}
    </>)},
  { id: "cabinet", name: "储物柜", category: "furniture", tags: ["储物","家具"], thumb: "#b8a888",
    render: () => (<>
      <mesh position={[0,0.4,0]} receiveShadow castShadow><boxGeometry args={[0.6,0.8,0.5]} /><meshStandardMaterial color="#b8a888" roughness={0.7} /></mesh>
      <mesh position={[0,0.04,0]} receiveShadow castShadow><boxGeometry args={[0.65,0.08,0.55]} /><meshStandardMaterial color="#b89a78" /></mesh>
    </>)},
  { id: "bedside", name: "床头柜", category: "furniture", tags: ["储物","家具","床头"], thumb: "#d4b898",
    render: () => (<>
      <mesh position={[0,0.3,0]} receiveShadow castShadow><boxGeometry args={[0.5,0.6,0.5]} /><meshStandardMaterial color="#d4b898" roughness={0.7} /></mesh>
      <mesh position={[0,0.04,0]} receiveShadow castShadow><boxGeometry args={[0.55,0.08,0.55]} /><meshStandardMaterial color="#b89a78" /></mesh>
    </>)},
]
