import { useState, useCallback, useMemo, useRef } from "react"
import { Canvas, useFrame, useThree } from "@react-three/fiber"
import { OrbitControls, ContactShadows } from "@react-three/drei"
import { Furniture } from "../components/Furniture"
import { GRID, gridToWorld } from "../components/GridConfig"
import { FURNI } from "../data/furniture-catalog"
import * as THREE from "three"

type Tool = "paint" | "erase" | "place"
const W = GRID.ROOM_W; const D = GRID.ROOM_D
interface PlacedItem { id: string; gx: number; gz: number; rotation: number }
const ICONS: Record<string, string> = {
  bed: "\u{1F6CF}", patient: "\u{1F9D1}", iv: "\u{1F489}",
  monitor: "\u{1F5A5}", chair: "\u{1FA91}", plant: "\u{1F33F}",
  cabinet: "\u{1F5C4}", bedside: "\u{1FA91}",
}

function initGrid(): boolean[][] {
  const g: boolean[][] = []
  for (let z = 0; z < D; z++) {
    const row: boolean[] = []
    for (let x = 0; x < W; x++) row.push(x >= 2 && x < 12 && z >= 2 && z < 10)
    g.push(row)
  }
  return g
}

function computeWalls(floor: boolean[][]): { x: number; z: number }[] {
  const walls: { x: number; z: number }[] = []
  for (let z = 0; z < D; z++) for (let x = 0; x < W; x++) {
    if (!floor[z][x]) continue
    if (z === 0 || !floor[z - 1][x]) { walls.push({ x, z }); continue }
    if (z === D - 1 || !floor[z + 1][x]) { walls.push({ x, z }); continue }
    if (x === 0 || !floor[z][x - 1]) { walls.push({ x, z }); continue }
    if (x === W - 1 || !floor[z][x + 1]) walls.push({ x, z })
  }
  return walls
}

// ── 2D Grid Cell ──
function GridCell({ floor, hasItem, icon, active, onDown, onEnter }: { floor: boolean; hasItem: boolean; icon: string; active: boolean; onDown: () => void; onEnter: () => void }) {
  return (<div onMouseDown={(e) => { e.preventDefault(); onDown() }} onMouseEnter={onEnter} onContextMenu={(e) => e.preventDefault()}
    style={{ width: "100%", aspectRatio: "1", background: floor ? "#ede8e2" : "#e8e0d8", border: active ? "2px solid #4fc3f7" : hasItem ? "2px solid #5a8" : "1px solid #ddd", borderRadius: 1, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, userSelect: "none" }}>
    {hasItem ? icon : ""}</div>)
}

// ── 3D Scene ──
function CameraReporter() {
  const { camera } = useThree()
  useFrame(() => { (window as any).__sceneCamPos = camera.position.clone() })
  return null
}

function Scene3D({ floor, items, selectedIdx, tool, placeId, onPlace }: {
  floor: boolean[][]; items: PlacedItem[]; selectedIdx: number
  tool: Tool; placeId: string; onPlace: (gx: number, gz: number) => void
}) {
  const walls = useMemo(() => computeWalls(floor), [floor])
  const [hover, setHover] = useState<{ gx: number; gz: number } | null>(null)
  const planeRef = useRef<THREE.Mesh>(null)

  const wallNormal = useCallback((w: { x: number; z: number }) => {
    if (w.z === 0 || floor[w.z - 1]?.[w.x] === false) return new THREE.Vector3(0, 0, -1)
    if (w.z === D - 1 || floor[w.z + 1]?.[w.x] === false) return new THREE.Vector3(0, 0, 1)
    if (w.x === 0 || floor[w.z]?.[w.x - 1] === false) return new THREE.Vector3(-1, 0, 0)
    return new THREE.Vector3(1, 0, 0)
  }, [floor])

  const wallVisible = useCallback((w: { x: number; z: number }) => {
    const n = wallNormal(w)
    const cp = (window as any).__sceneCamPos as THREE.Vector3 | undefined
    if (!cp) return true
    const wp = gridToWorld({ gx: w.x, gz: w.z }, 0)
    const toCam = new THREE.Vector3(cp.x - wp[0], 0, cp.z - wp[2]).normalize()
    return toCam.dot(n) <= 0 // camera inside → show; outside → hide
  }, [wallNormal])

  const handlePointerDown = useCallback((e: any) => {
    if (tool !== "place") return
    const p = e.point; const gx = Math.round((p.x + GRID.W / 2) / GRID.UNIT - 0.5)
    const gz = Math.round((p.z + GRID.D / 2) / GRID.UNIT - 0.5)
    if (gx >= 0 && gx < W && gz >= 0 && gz < D && floor[gz][gx]) onPlace(gx, gz)
  }, [tool, floor, onPlace])

  const handlePointerMove = useCallback((e: any) => {
    if (tool !== "place") { setHover(null); return }
    const p = e.point; const gx = Math.round((p.x + GRID.W / 2) / GRID.UNIT - 0.5)
    const gz = Math.round((p.z + GRID.D / 2) / GRID.UNIT - 0.5)
    if (gx >= 0 && gx < W && gz >= 0 && gz < D && floor[gz][gx]) setHover({ gx, gz })
    else setHover(null)
  }, [tool, floor])

  return (<>
    <ambientLight intensity={0.5} />
    <directionalLight position={[4, 7, 5]} intensity={0.65} castShadow shadow-mapSize-width={1024} shadow-mapSize-height={1024} shadow-bias={-0.001} />
    <directionalLight position={[-2, 3, 1]} intensity={0.25} />
    <hemisphereLight args={["#e8d8c8", "#c8d8e0", 0.3]} />
    <CameraReporter />
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0]} ref={planeRef}
      onPointerDown={handlePointerDown} onPointerMove={handlePointerMove}>
      <planeGeometry args={[GRID.W + 2, GRID.D + 2]} /><meshStandardMaterial color="#e8e0d8" roughness={0.95} side={2} transparent opacity={0.01} />
    </mesh>
    {floor.flatMap((row, gz) => row.map((isFloor, gx) => isFloor ? (
      <mesh key={`f-${gx}-${gz}`} position={[gridToWorld({ gx, gz }, 0)[0], -0.01, gridToWorld({ gx, gz }, 0)[2]]} receiveShadow>
        <boxGeometry args={[GRID.UNIT - 0.02, 0.02, GRID.UNIT - 0.02]} /><meshStandardMaterial color="#ede8e2" roughness={0.9} />
      </mesh>
    ) : null))}
    {walls.map((w, i) => {
      const n = wallNormal(w)
      // Thin wall panel: thickness 0.08m, positioned at cell edge
      const isX = n.x !== 0
      return wallVisible(w) ? (
        <mesh key={i} position={[
          gridToWorld({ gx: w.x, gz: w.z }, 0)[0] + n.x * GRID.UNIT / 2,
          1.5,
          gridToWorld({ gx: w.x, gz: w.z }, 0)[2] + n.z * GRID.UNIT / 2,
        ]} castShadow receiveShadow>
          <boxGeometry args={isX ? [0.08, 3, GRID.UNIT] : [GRID.UNIT, 3, 0.08]} />
          <meshStandardMaterial color="#faf6f0" roughness={0.8} />
        </mesh>
      ) : null
    })}
    {items.map((item, i) => {
      const def = FURNI.find((f) => f.id === item.id)
      if (!def) return null
      return (<group key={`${item.gx}-${item.gz}`}>
        <Furniture gx={item.gx} gz={item.gz} rotation={item.rotation}>{def.render({ gx: item.gx, gz: item.gz })}</Furniture>
        {i === selectedIdx && <mesh position={[gridToWorld({ gx: item.gx, gz: item.gz }, 0)[0], 2.8, gridToWorld({ gx: item.gx, gz: item.gz }, 0)[2]]}>
          <boxGeometry args={[GRID.UNIT * 1.1, 0.05, GRID.UNIT * 1.1]} /><meshBasicMaterial color="#4fc3f7" transparent opacity={0.25} />
        </mesh>}
      </group>)
    })}
    {/* Hover preview */}
    {hover && tool === "place" && <mesh position={[gridToWorld({ gx: hover.gx, gz: hover.gz }, 0)[0], 0.1, gridToWorld({ gx: hover.gx, gz: hover.gz }, 0)[2]]}>
      <boxGeometry args={[GRID.UNIT * 0.9, 0.02, GRID.UNIT * 0.9]} /><meshBasicMaterial color="#4fc3f7" transparent opacity={0.3} />
    </mesh>}
    <ContactShadows position={[0, -0.01, 0]} opacity={0.2} scale={10} blur={3} far={3} />
  </>)
}

// ── Main Component ──
export default function SceneEditor() {
  const [floor, setFloor] = useState<boolean[][]>(initGrid)
  const [items, setItems] = useState<PlacedItem[]>([])
  const [selectedIdx, setSelectedIdx] = useState(-1)
  const [tool, setTool] = useState<Tool>("paint")
  const [placeId, setPlaceId] = useState("bed")
  const painting = useRef(false); const paintVal = useRef(true)
  const sel = selectedIdx >= 0 && selectedIdx < items.length ? items[selectedIdx] : null

  const applyCell = useCallback((gz: number, gx: number, val: boolean) => {
    setFloor((prev) => { if (prev[gz][gx] === val) return prev; const g = prev.map((r) => [...r]); g[gz][gx] = val; return g })
  }, [])

  const cellMouseDown = useCallback((gz: number, gx: number) => {
    if (tool === "place") {
      if (!floor[gz][gx]) { setSelectedIdx(-1); return }
      setItems((prev) => [...prev, { id: placeId, gx, gz, rotation: 0 }]); setSelectedIdx(items.length); return
    }
    if (tool === "paint") { painting.current = true; paintVal.current = true; applyCell(gz, gx, true); return }
    if (tool === "erase") { painting.current = true; paintVal.current = false; applyCell(gz, gx, false); return }
    const hits = items.map((item, i) => item.gx === gx && item.gz === gz ? i : -1).filter((i) => i >= 0)
    if (hits.length === 0) { setSelectedIdx(-1); return }
    const cur = hits.indexOf(selectedIdx); setSelectedIdx(hits[(cur + 1) % hits.length])
  }, [tool, placeId, floor, items, selectedIdx, applyCell])

  const cellMouseEnter = useCallback((gz: number, gx: number) => {
    if (!painting.current) return
    if (tool === "paint" || tool === "erase") applyCell(gz, gx, paintVal.current)
  }, [tool, applyCell])

  const handle3DPlace = useCallback((gx: number, gz: number) => {
    setItems((prev) => [...prev, { id: placeId, gx, gz, rotation: 0 }]); setSelectedIdx(items.length)
  }, [placeId, items.length])

  const updateItem = useCallback((idx: number, p: Partial<PlacedItem>) => setItems((prev) => prev.map((item, i) => i === idx ? { ...item, ...p } : item)), [])
  const deleteItem = useCallback((idx: number) => { setItems((prev) => prev.filter((_, i) => i !== idx)); setSelectedIdx(-1) }, [])

  return (
    <div style={{ display: "flex", height: "100%", fontFamily: "system-ui", background: "#f0ece6", color: "#333" }}
      onMouseUp={() => { painting.current = false }} onMouseLeave={() => { painting.current = false }}>
      {/* Catalog */}
      <div style={{ width: 120, background: "#faf6f0", borderRight: "1px solid #e0d8d0", display: "flex", flexDirection: "column", flexShrink: 0 }}>
        <div style={{ padding: "5px 6px", fontSize: 9, color: "#999", fontWeight: 600, borderBottom: "1px solid #e0d8d0" }}>CATALOG</div>
        <div style={{ flex: 1, overflow: "auto", padding: 4 }}>
          {FURNI.map((f) => (
            <button key={f.id} onClick={() => { setPlaceId(f.id); setTool("place") }}
              style={{ display: "flex", alignItems: "center", gap: 4, width: "100%", padding: "4px 6px", marginBottom: 2, borderRadius: 4,
                border: `1px solid ${placeId === f.id && tool === "place" ? "#4fc3f7" : "transparent"}`,
                background: placeId === f.id && tool === "place" ? "#4fc3f718" : "transparent", cursor: "pointer", textAlign: "left", fontSize: 9, color: "#555" }}>
              <span>{ICONS[f.id] ?? "▣"}</span><span>{f.name}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Main: side-by-side 2D grid + 3D view */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 3, padding: "3px 8px", background: "#faf6f0", borderBottom: "1px solid #e0d8d0", fontSize: 9, flexShrink: 0 }}>
          {(["paint", "erase", "place"] as Tool[]).map((t) => (
            <button key={t} onClick={() => setTool(t)}
              style={{ padding: "2px 8px", borderRadius: 3, border: `1px solid ${tool === t ? "#4fc3f7" : "#ddd"}`, cursor: "pointer", fontSize: 9,
                background: tool === t ? "#4fc3f722" : "transparent", color: tool === t ? "#4fc3f7" : "#888" }}>
              {t === "paint" ? "▣ Paint" : t === "erase" ? "✕ Erase" : `⬡ ${ICONS[placeId] ?? ""}`}
            </button>
          ))}
          <span style={{ flex: 1 }} />
          <span style={{ color: "#bbb", fontSize: 8 }}>{items.length} items</span>
        </div>
        <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
          {/* 2D Grid */}
          <div style={{ overflow: "auto", padding: 8, display: "flex", alignItems: "flex-start", justifyContent: "center", flexShrink: 0 }}>
            <div style={{ display: "grid", gridTemplateColumns: `repeat(${W}, 20px)`, gap: 0, userSelect: "none" }} onContextMenu={(e) => e.preventDefault()}>
              {floor.flatMap((row, gz) => row.map((isFloor, gx) => (
                <GridCell key={`${gz}-${gx}`} floor={isFloor}
                  hasItem={items.some((i) => i.gx === gx && i.gz === gz)}
                  icon={ICONS[items.find((i) => i.gx === gx && i.gz === gz)?.id ?? ""] ?? "⬡"}
                  active={sel?.gx === gx && sel?.gz === gz}
                  onDown={() => cellMouseDown(gz, gx)} onEnter={() => cellMouseEnter(gz, gx)} />
              )))}
            </div>
          </div>
          {/* 3D View — fills remaining space */}
          <div style={{ flex: 1, minWidth: 200, margin: 6, borderRadius: 8, overflow: "hidden" }}>
            <Canvas orthographic camera={{ position: [5, 10, 7], zoom: 30, near: -10, far: 20 }}
              shadows style={{ width: "100%", height: "100%", background: "#e8e0d8" }}>
              <Scene3D floor={floor} items={items} selectedIdx={selectedIdx} tool={tool} placeId={placeId} onPlace={handle3DPlace} />
              <OrbitControls enableRotate enableZoom enablePan zoomSpeed={0.8} panSpeed={0.4} minPolarAngle={0.3} maxPolarAngle={1.2} target={[0, 0.8, 0]} enableDamping dampingFactor={0.1} />
            </Canvas>
          </div>
        </div>
      </div>

      {/* Right panel */}
      <div style={{ width: 140, background: "#faf6f0", borderLeft: "1px solid #e0d8d0", display: "flex", flexDirection: "column", flexShrink: 0 }}>
        <div style={{ padding: "5px 6px", fontSize: 9, color: "#999", fontWeight: 600, borderBottom: "1px solid #e0d8d0" }}>ITEMS ({items.length})</div>
        <div style={{ flex: 1, overflow: "auto", padding: 4, fontSize: 9 }}>
          {items.map((item, i) => {
            const def = FURNI.find((f) => f.id === item.id)
            return (<div key={i} onClick={() => setSelectedIdx(i)}
              style={{ display: "flex", alignItems: "center", gap: 3, padding: "3px 5px", borderRadius: 3, marginBottom: 2, cursor: "pointer", background: i === selectedIdx ? "#4fc3f718" : "transparent", border: i === selectedIdx ? "1px solid #4fc3f7" : "1px solid transparent" }}>
              <span>{ICONS[item.id] ?? "▣"}</span>
              <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis" }}>{def?.name ?? item.id}</span>
              <span style={{ color: "#bbb", fontSize: 8 }}>{item.gx},{item.gz}</span>
            </div>)
          })}
          {items.length === 0 && <div style={{ color: "#bbb", textAlign: "center", padding: "12px 0" }}>No items</div>}
        </div>
        {sel && <div style={{ borderTop: "1px solid #e0d8d0", padding: 6 }}>
          <div style={{ fontSize: 8, color: "#999", fontWeight: 600, marginBottom: 3 }}>PROPERTIES</div>
          <Slider8 label="R" value={sel.rotation} min={0} max={360} step={15} onChange={(v) => updateItem(selectedIdx, { rotation: v })} />
          <Slider8 label="X" value={sel.gx} min={0} max={W - 1} step={1} onChange={(v) => updateItem(selectedIdx, { gx: v })} />
          <Slider8 label="Z" value={sel.gz} min={0} max={D - 1} step={1} onChange={(v) => updateItem(selectedIdx, { gz: v })} />
          <button onClick={() => deleteItem(selectedIdx)}
            style={{ width: "100%", padding: "3px 0", borderRadius: 3, border: "1px solid #e74c3c44", background: "#e74c3c18", color: "#e74c3c", cursor: "pointer", fontSize: 8, marginTop: 2 }}>Delete</button>
        </div>}
      </div>
    </div>
  )
}

function Slider8({ label, value, min, max, step, onChange }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void }) {
  return (<div style={{ display: "flex", alignItems: "center", gap: 3, marginBottom: 3 }}>
    <span style={{ fontSize: 8, color: "#888", width: 12 }}>{label}</span>
    <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))}
      style={{ flex: 1, height: 2, accentColor: "#4fc3f7", cursor: "pointer" }} />
    <span style={{ fontSize: 8, color: "#888", width: 24, textAlign: "right" }}>{value}{label === "R" ? "\u00b0" : ""}</span>
  </div>)
}
