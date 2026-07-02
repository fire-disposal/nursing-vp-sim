import { useState, useCallback, useMemo, useRef, useEffect } from "react"
import { Canvas, useFrame } from "@react-three/fiber"
import { OrbitControls } from "@react-three/drei"
import { Furniture } from "../components/Furniture"
import { GRID, gridToWorld } from "../components/GridConfig"
import { FURNI } from "../data/furniture-catalog"
import type { FurniDef } from "../data/furniture-catalog"
import * as THREE from "three"

type Tool = "paint" | "erase" | "place"
const W = GRID.ROOM_W; const D = GRID.ROOM_D
interface PlacedItem { id: string; gx: number; gz: number; rotation: number; ty: number }
const ICONS: Record<string, string> = {
  bed: "\u{1F6CF}", patient: "\u{1F9D1}", iv: "\u{1F489}",
  monitor: "\u{1F5A5}", chair: "\u{1FA91}", plant: "\u{1F33F}",
  cabinet: "\u{1F5C4}", bedside: "\u{1FA91}",
}

function useDark(): boolean {
  const [d, setD] = useState(() => document.documentElement.classList.contains("dark"))
  useEffect(() => {
    const obs = new MutationObserver(() => setD(document.documentElement.classList.contains("dark")))
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] })
    return () => obs.disconnect()
  }, [])
  return d
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

interface WallFace { x: number; z: number; nx: number; nz: number }
function computeWalls(floor: boolean[][]): WallFace[] {
  const w: WallFace[] = []
  for (let z = 0; z < D; z++) for (let x = 0; x < W; x++) {
    if (!floor[z][x]) continue
    if (z === 0 || !floor[z - 1][x]) w.push({ x, z, nx: 0, nz: -1 })
    if (z === D - 1 || !floor[z + 1][x]) w.push({ x, z, nx: 0, nz: 1 })
    if (x === 0 || !floor[z][x - 1]) w.push({ x, z, nx: -1, nz: 0 })
    if (x === W - 1 || !floor[z][x + 1]) w.push({ x, z, nx: 1, nz: 0 })
  }
  return w
}

function GridCell({ floor, hasItem, icon, active, highlighted, onDown, onRight, onEnter }: any) {
  const dark = useDark()
  let bg: string
  if (highlighted) bg = dark ? "#2a5a5a" : "#b8e8b8"
  else if (floor) bg = dark ? "#1a2a2a" : "#e0e8e0"
  else bg = dark ? "#14141c" : "#f0ece6"
  return (<div onMouseDown={(e) => { e.preventDefault(); if (e.button === 2) onRight(); else onDown() }} onMouseEnter={onEnter} onContextMenu={(e) => e.preventDefault()}
    style={{ width: "100%", aspectRatio: "1", background: bg, border: highlighted ? "2px solid #4fc3f7" : active ? "2px solid var(--accent)" : hasItem ? "2px solid #5a8" : `1px solid ${dark ? "#222" : "#ddd"}`, borderRadius: 1, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, userSelect: "none", color: hasItem ? "#8a8" : "#444" }}>
    {hasItem ? icon : ""}</div>)
}

function GhostPreview({ def, dark }: { def: FurniDef; dark: boolean }) {
  const groupRef = useRef<THREE.Group>(null)
  useEffect(() => {
    if (!groupRef.current) return
    groupRef.current.traverse((child) => {
      if (child instanceof THREE.Mesh && child.material) {
        const m = child.material as THREE.MeshStandardMaterial
        m.transparent = true
        m.opacity = dark ? 0.2 : 0.25
        m.depthWrite = false
      }
    })
  }, [def, dark])
  return <group ref={groupRef} renderOrder={-1}>{def.render({ gx: 0, gz: 0 })}</group>
}

function RotationHandles({ gx, gz, ty, onRotate }: { gx: number; gz: number; ty: number; onRotate: (delta: number) => void }) {
  const pos = gridToWorld({ gx, gz }, 0)
  const y = 0.08 + ty
  const R = 0.65
  const ac = "#4fc3f7"
  const arrow = (dir: number, xOff: number, zOff: number, rx: number, rz: number) => (
    <group position={[pos[0] + xOff * R, y, pos[2] + zOff * R]} onClick={(e) => { e.stopPropagation(); onRotate(dir) }}>
      <mesh><ringGeometry args={[0.07, 0.12, 12]} /><meshBasicMaterial color={ac} transparent opacity={0.7} depthWrite={false} /></mesh>
      <mesh position={[xOff * 0.18, 0, zOff * 0.18]} rotation={[rx, 0, rz]}><coneGeometry args={[0.04, 0.07, 6]} /><meshBasicMaterial color={ac} transparent opacity={0.7} depthWrite={false} /></mesh>
    </group>
  )
  return (<group>
    {arrow(15, 1, 0, 0, -Math.PI / 2)}
    {arrow(-15, -1, 0, 0, Math.PI / 2)}
    {arrow(15, 0, -1, Math.PI / 2, 0)}
    {arrow(-15, 0, 1, -Math.PI / 2, 0)}
  </group>)
}

function SelectionGlow({ gx, gz, ty }: { gx: number; gz: number; ty: number }) {
  const meshRef = useRef<THREE.Mesh>(null)
  useFrame(() => {
    if (meshRef.current) {
      (meshRef.current.material as THREE.MeshBasicMaterial).opacity = 0.2 + Math.sin(performance.now() * 0.004) * 0.08
    }
  })
  const pos = gridToWorld({ gx, gz }, 0)
  return <mesh ref={meshRef} position={[pos[0], 2.7 + ty, pos[2]]} renderOrder={10}>
    <boxGeometry args={[GRID.UNIT * 1.15, 0.06, GRID.UNIT * 1.15]} />
    <meshBasicMaterial color="#4fc3f7" transparent depthWrite={false} />
  </mesh>
}

function Scene3D({ floor, items, selectedIdx, tool, placeId, onPlace, onRotate, dark }: {
  floor: boolean[][]; items: PlacedItem[]; selectedIdx: number
  tool: Tool; placeId: string; onPlace: (gx: number, gz: number) => void; onRotate: (delta: number) => void; dark: boolean
}) {
  const walls = useMemo(() => computeWalls(floor), [floor])
  const [hover, setHover] = useState<{ gx: number; gz: number } | null>(null)
  const [camPos, setCamPos] = useState<THREE.Vector3 | null>(null)
  useFrame(({ camera }) => setCamPos(camera.position.clone()))

  const wallVisible = useCallback((w: WallFace) => {
    if (!camPos) return true
    const wp = gridToWorld({ gx: w.x, gz: w.z }, 0)
    const v = new THREE.Vector3(camPos.x - wp[0], 0, camPos.z - wp[2]).normalize()
    return v.x * w.nx + v.z * w.nz <= 0
  }, [camPos])

  const c = (light: string, d: string) => dark ? d : light
  const FLOOR_COL = c("#ede8e2", "#1e2e2e")
  const WALL_COL = c("#faf6f0", "#2a3a4a")
  const GROUND_COL = c("#e8e0d8", "#0d0d14")

  const hoverDef = useMemo(() => hover && tool === "place" ? FURNI.find(f => f.id === placeId) ?? null : null, [hover, tool, placeId])

  return (<>
    <ambientLight intensity={0.5} />
    <directionalLight position={[4, 7, 5]} intensity={0.65} />
    <directionalLight position={[-2, 3, 1]} intensity={0.25} />
    <hemisphereLight args={["#e8d8c8", "#c8d8e0", 0.3]} />
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0]}
      onPointerDown={(e: any) => { if (tool === "place") { const p = e.point; const gx = Math.round((p.x + GRID.W/2) / GRID.UNIT - 0.5); const gz = Math.round((p.z + GRID.D/2) / GRID.UNIT - 0.5); if (gx >= 0 && gx < W && gz >= 0 && gz < D && floor[gz][gx]) onPlace(gx, gz) } }}
      onPointerMove={(e: any) => { if (tool !== "place") { setHover(null); return }; const p = e.point; const gx = Math.round((p.x + GRID.W/2) / GRID.UNIT - 0.5); const gz = Math.round((p.z + GRID.D/2) / GRID.UNIT - 0.5); if (gx >= 0 && gx < W && gz >= 0 && gz < D && floor[gz][gx]) setHover({gx,gz}); else setHover(null) }}>
      <planeGeometry args={[GRID.W + 2, GRID.D + 2]} /><meshStandardMaterial color={GROUND_COL} roughness={0.95} side={2} transparent opacity={0.01} />
    </mesh>
    {floor.flatMap((row, gz) => row.map((isFloor, gx) => isFloor ? (
      <mesh key={`f-${gx}-${gz}`} position={[gridToWorld({gx,gz},0)[0], -0.01, gridToWorld({gx,gz},0)[2]]}>
        <boxGeometry args={[GRID.UNIT - 0.02, 0.02, GRID.UNIT - 0.02]} /><meshStandardMaterial color={FLOOR_COL} roughness={0.9} />
      </mesh>
    ) : null))}
    {walls.map((w, i) => {
      const p = gridToWorld({gx:w.x,gz:w.z},0); const TH = 0.08
      return wallVisible(w) ? (
        <mesh key={i} position={[p[0]+w.nx*(GRID.UNIT/2+TH/2), 1.5, p[2]+w.nz*(GRID.UNIT/2+TH/2)]}>
          <boxGeometry args={[w.nx !== 0 ? TH : GRID.UNIT, 3, w.nz !== 0 ? TH : GRID.UNIT]} /><meshStandardMaterial color={WALL_COL} roughness={0.8} />
        </mesh>
      ) : null
    })}
    {items.map((item, i) => {
      const def = FURNI.find((f) => f.id === item.id); if (!def) return null
      return (<group key={`${item.gx}-${item.gz}`}>
        <group position={[0, item.ty, 0]}><Furniture gx={item.gx} gz={item.gz} rotation={item.rotation}>{def.render({gx:item.gx,gz:item.gz})}</Furniture></group>
        {i === selectedIdx && <SelectionGlow gx={item.gx} gz={item.gz} ty={item.ty} />}
        {i === selectedIdx && <RotationHandles gx={item.gx} gz={item.gz} ty={item.ty} onRotate={onRotate} />}
      </group>)
    })}
    {hoverDef && hover && <group position={[gridToWorld({gx:hover.gx,gz:hover.gz},0)[0], 0.005, gridToWorld({gx:hover.gx,gz:hover.gz},0)[2]]}>
      <GhostPreview def={hoverDef} dark={dark} />
    </group>}
  </>)
}

export default function SceneEditor() {
  const dark = useDark()
  const [floor, setFloor] = useState<boolean[][]>(initGrid)
  const [items, setItems] = useState<PlacedItem[]>([])
  const [selectedIdx, setSelectedIdx] = useState(-1)
  const [tool, setTool] = useState<Tool>("paint")
  const [placeId, setPlaceId] = useState("bed")
  const [search, setSearch] = useState("")
  const [cat, setCat] = useState("")
  const [showHelp, setShowHelp] = useState(false)
  const [hlSet, setHlSet] = useState<Set<string>>(new Set())
  const ALL_CATS = useMemo(() => [...new Set(FURNI.map((f) => f.category))], [])
  const painting = useRef(false); const paintVal = useRef(true)
  const sel = selectedIdx >= 0 && selectedIdx < items.length ? items[selectedIdx] : null

  const applyCell = useCallback((gz: number, gx: number, val: boolean) => setFloor((p) => { if (p[gz][gx] === val) return p; const g = p.map(r=>[...r]); g[gz][gx] = val; return g }), [])
  const cycleCell = useCallback((gz: number, gx: number) => setFloor((p) => { const g = p.map(r=>[...r]); g[gz][gx] = !g[gz][gx]; return g }), [])

  const addHl = useCallback((gz: number, gx: number) => {
    setHlSet(prev => { const next = new Set(prev); next.add(`${gz},${gx}`); return next })
  }, [])
  const clearHl = useCallback(() => setHlSet(new Set()), [])

  const cellDown = useCallback((gz: number, gx: number) => {
    if (tool === "paint") { painting.current = true; paintVal.current = true; applyCell(gz, gx, true); addHl(gz, gx); return }
    if (tool === "erase") { painting.current = true; paintVal.current = false; applyCell(gz, gx, false); addHl(gz, gx); return }
    const hits = items.map((it,i) => it.gx===gx&&it.gz===gz ? i : -1).filter(i=>i>=0)
    if (hits.length===0) { setSelectedIdx(-1); if (tool !== "place") cycleCell(gz,gx); return }
    const cur = hits.indexOf(selectedIdx); setSelectedIdx(hits[(cur+1)%hits.length])
  }, [tool, items, selectedIdx, applyCell, cycleCell, addHl])

  const cellRight = useCallback((gz: number, gx: number) => {
    if (tool === "place") { if (!floor[gz][gx]) return; setItems(p=>[...p,{id:placeId,gx,gz,rotation:0,ty:0}]); setSelectedIdx(items.length) }
    else if (tool === "erase") applyCell(gz,gx,false)
  }, [tool, placeId, floor, items.length, applyCell])

  const handle3DPlace = useCallback((gx: number, gz: number) => setItems(p=>[...p,{id:placeId,gx,gz,rotation:0,ty:0}]), [placeId])
  const updItem = useCallback((i: number, p: Partial<PlacedItem>) => setItems(prev => prev.map((it,idx) => idx===i ? {...it,...p} : it)), [])
  const delItem = useCallback((i: number) => { setItems(p=>p.filter((_,idx)=>idx!==i)); setSelectedIdx(-1) }, [])

  const rotateSelected = useCallback((delta: number) => {
    if (selectedIdx >= 0 && items[selectedIdx]) {
      const cur = items[selectedIdx].rotation
      updItem(selectedIdx, { rotation: ((cur + delta) % 360 + 360) % 360 })
    }
  }, [selectedIdx, items, updItem])

  const filteredCatalog = useMemo(
    () => (cat ? FURNI.filter(f => f.category === cat) : FURNI).filter(f => !search || f.name.includes(search) || f.tags.some(t=>t.includes(search))),
    [cat, search]
  )

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && e.target.tagName === "INPUT") return
      const k = e.key.toLowerCase()
      if (k === "p") { e.preventDefault(); setTool("paint") }
      else if (k === "e") { e.preventDefault(); setTool("erase") }
      else if (k === "v") { e.preventDefault(); setTool("place") }
      else if ((k === "delete" || k === "backspace") && selectedIdx >= 0) { e.preventDefault(); delItem(selectedIdx) }
      else if (k === "r" && !e.ctrlKey && !e.metaKey && selectedIdx >= 0) { e.preventDefault(); rotateSelected(15) }
      else if (k === "?" || k === "h") { e.preventDefault(); setShowHelp(p => !p) }
      else if (/^[1-9]$/.test(k)) {
        const idx = parseInt(k, 10) - 1
        if (idx < filteredCatalog.length) { setPlaceId(filteredCatalog[idx].id); setTool("place") }
      }
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [selectedIdx, rotateSelected, delItem, filteredCatalog])

  const c = (l: string, d: string) => dark ? d : l
  const BG = c("#f0ece6", "#12121e"); const PANEL = c("#faf6f0", "#16161e"); const BD = c("#e0d8d0", "#2a2a35")

  return (
    <div style={{ display: "flex", height: "100%", fontFamily: "system-ui", background: BG, color: "var(--fg)", fontSize: 11 }}
      onMouseUp={() => { painting.current = false; clearHl() }} onMouseLeave={() => { painting.current = false; clearHl() }}>

      {/* Catalog */}
      <div style={{ width: 150, background: PANEL, borderRight: `1px solid ${BD}`, display: "flex", flexDirection: "column", flexShrink: 0 }}>
        <div style={{ padding: "6px 8px", fontSize: 9, color: "var(--muted-fg)", fontWeight: 600, letterSpacing: 0.5, borderBottom: `1px solid ${BD}` }}>CATALOG</div>
        <div style={{ padding: "5px 7px", borderBottom: `1px solid ${BD}` }}>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search…"
            style={{ width: "100%", padding: "3px 6px", background: "var(--bg)", border: `1px solid ${BD}`, borderRadius: 4, color: "var(--fg)", fontSize: 10, outline: "none" }} />
          <div style={{ display: "flex", gap: 2, marginTop: 4, flexWrap: "wrap" }}>
            <button onClick={() => setCat("")}
              style={{ padding: "1px 5px", borderRadius: 3, border: "none", cursor: "pointer", fontSize: 8, background: cat==="" ? "var(--accent)22" : "transparent", color: cat==="" ? "var(--accent)" : "var(--muted-fg)" }}>All</button>
            {ALL_CATS.map(c => (
              <button key={c} onClick={() => setCat(c)}
                style={{ padding: "1px 5px", borderRadius: 3, border: "none", cursor: "pointer", fontSize: 8, background: cat===c ? "var(--accent)22" : "transparent", color: cat===c ? "var(--accent)" : "var(--muted-fg)" }}>{c}</button>
            ))}
          </div>
        </div>
        <div style={{ flex: 1, overflow: "auto", padding: "3px 5px" }}>
          {filteredCatalog.map((f, i) => (
            <button key={f.id} onClick={() => { setPlaceId(f.id); setTool("place") }}
              style={{ display: "flex", alignItems: "center", gap: 4, width: "100%", padding: "5px 6px", marginBottom: 1, borderRadius: 4,
                border: `1px solid ${placeId===f.id&&tool==="place" ? "var(--accent)" : "transparent"}`,
                background: placeId===f.id&&tool==="place" ? "var(--accent)12" : "transparent", cursor: "pointer", textAlign: "left", fontSize: 10, color: "var(--fg)" }}>
              <span>{ICONS[f.id] ?? "▣"}</span><span>{f.name}</span>
              {i < 9 && <span style={{ marginLeft: "auto", color: "var(--muted-fg)", fontSize: 7, fontFamily: "monospace" }}>[{i+1}]</span>}
              {f.tags.length>0 && !(i < 9) && <span style={{ marginLeft: "auto", color: "var(--muted-fg)", fontSize: 8 }}>#{f.tags[0]}</span>}
            </button>
          ))}
        </div>
      </div>

      {/* Main */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 4, padding: "4px 10px", background: PANEL, borderBottom: `1px solid ${BD}`, fontSize: 10, flexShrink: 0 }}>
          {(["paint","erase","place"] as Tool[]).map(t => (
            <button key={t} onClick={() => setTool(t)}
              title={t==="paint" ? "Paint [P]" : t==="erase" ? "Erase [E]" : "Place [V]"}
              style={{ padding: "3px 10px", borderRadius: 4, border: `1px solid ${tool===t ? "var(--accent)" : BD}`, cursor: "pointer", fontSize: 10,
                background: tool===t ? "var(--accent)12" : "var(--bg)", color: tool===t ? "var(--accent)" : "var(--muted-fg)" }}>
              {t==="paint" ? "▣ Paint" : t==="erase" ? "✕ Erase" : `⬡ ${ICONS[placeId]??""}`}
            </button>
          ))}
          <span style={{ flex: 1 }} />
          <button onClick={() => setShowHelp(p => !p)} title="Help [?]"
            style={{ padding: "2px 6px", borderRadius: 3, border: `1px solid ${BD}`, cursor: "pointer", fontSize: 9, background: showHelp ? "var(--accent)12" : "transparent", color: showHelp ? "var(--accent)" : "var(--muted-fg)" }}>?</button>
          <span style={{ color: "var(--muted-fg)", fontSize: 9 }}>{items.length} items</span>
        </div>
        <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
          <div style={{ overflow: "auto", padding: 10, display: "flex", alignItems: "flex-start", justifyContent: "center", flexShrink: 0 }}>
            <div style={{ display: "grid", gridTemplateColumns: `repeat(${W}, 22px)`, gap: 0, userSelect: "none" }} onContextMenu={e=>e.preventDefault()}>
              {floor.flatMap((row, gz) => row.map((isFloor, gx) => (
                <GridCell key={`${gz}-${gx}`} floor={isFloor}
                  hasItem={items.some(i=>i.gx===gx&&i.gz===gz)}
                  icon={ICONS[items.find(i=>i.gx===gx&&i.gz===gz)?.id??""] ?? "⬡"}
                  active={sel?.gx===gx&&sel?.gz===gz}
                  highlighted={hlSet.has(`${gz},${gx}`)}
                  onDown={() => cellDown(gz,gx)} onRight={() => cellRight(gz,gx)} onEnter={() => { if (painting.current && (tool==="paint"||tool==="erase")) { applyCell(gz,gx,paintVal.current); addHl(gz,gx) } }} />
              )))}
            </div>
          </div>
          <div style={{ flex: 1, minWidth: 200, margin: 6, borderRadius: 8, overflow: "hidden" }}>
            <Canvas orthographic camera={{ position: [5,10,7], zoom: 30, near: -10, far: 20 }}
              style={{ width: "100%", height: "100%", background: dark ? "#0d0d14" : "#e8e0d8" }}>
              <Scene3D floor={floor} items={items} selectedIdx={selectedIdx} tool={tool} placeId={placeId} onPlace={handle3DPlace} onRotate={rotateSelected} dark={dark} />
              <OrbitControls enableRotate enableZoom enablePan zoomSpeed={0.8} panSpeed={0.4} minPolarAngle={0.3} maxPolarAngle={1.2} target={[0,0.8,0]} enableDamping dampingFactor={0.1} />
            </Canvas>
          </div>
        </div>
      </div>

      {/* Right */}
      <div style={{ width: 150, background: PANEL, borderLeft: `1px solid ${BD}`, display: "flex", flexDirection: "column", flexShrink: 0 }}>
        <div style={{ padding: "6px 8px", fontSize: 9, color: "var(--muted-fg)", fontWeight: 600, letterSpacing: 0.5, borderBottom: `1px solid ${BD}` }}>ITEMS ({items.length})</div>
        <div style={{ flex: 1, overflow: "auto", padding: "4px 6px", fontSize: 10 }}>
          {items.map((item, i) => {
            const def = FURNI.find(f=>f.id===item.id)
            return (<div key={i} onClick={()=>setSelectedIdx(i)}
              style={{ display: "flex", alignItems: "center", gap: 3, padding: "4px 6px", borderRadius: 4, marginBottom: 1, cursor: "pointer", background: i===selectedIdx ? "var(--accent)12" : "transparent", border: i===selectedIdx ? "1px solid var(--accent)" : "1px solid transparent" }}>
              <span>{ICONS[item.id] ?? "▣"}</span>
              <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", color: "var(--fg)" }}>{def?.name??item.id}</span>
              <span style={{ color: "var(--muted-fg)", fontSize: 9 }}>{item.gx},{item.gz}</span>
            </div>)
          })}
          {items.length===0 && <div style={{ color: "var(--muted-fg)", textAlign: "center", padding: "16px 0", fontSize: 10 }}>No items</div>}
        </div>
        {sel && <div style={{ borderTop: `1px solid ${BD}`, padding: "6px 8px" }}>
          <div style={{ fontSize: 8, color: "var(--muted-fg)", fontWeight: 600, letterSpacing: 0.5, marginBottom: 4 }}>PROPERTIES</div>
          <Slider8 label="R" value={sel.rotation} min={0} max={360} step={15} onChange={v=>updItem(selectedIdx,{rotation:v})} />
          <Slider8 label="Y" value={sel.ty} min={-0.5} max={2} step={0.05} onChange={v=>updItem(selectedIdx,{ty:v})} />
          <Slider8 label="X" value={sel.gx} min={0} max={W-1} step={1} onChange={v=>updItem(selectedIdx,{gx:v})} />
          <Slider8 label="Z" value={sel.gz} min={0} max={D-1} step={1} onChange={v=>updItem(selectedIdx,{gz:v})} />
          <button onClick={()=>delItem(selectedIdx)} title="Delete [Del]"
            style={{ width: "100%", padding: "4px 0", marginTop: 4, borderRadius: 4, border: "1px solid #e74c3c33", background: "#e74c3c12", color: "#e74c3c", cursor: "pointer", fontSize: 9 }}>Delete</button>
        </div>}
      </div>

      {/* Help overlay */}
      {showHelp && <div style={{ position: "fixed", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.5)", zIndex: 100, fontFamily: "system-ui" }}
        onClick={() => setShowHelp(false)}>
        <div style={{ background: dark ? "#1a1a2e" : "#faf6f0", border: `1px solid ${BD}`, borderRadius: 12, padding: "24px 32px", minWidth: 280, color: "var(--fg)", fontSize: 13 }}
          onClick={e => e.stopPropagation()}>
          <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 12 }}>Keyboard Shortcuts</div>
          <div style={{ display: "grid", gridTemplateColumns: "60px 1fr", gap: "6px 12px", fontSize: 12 }}>
            <span style={{ color: "#4fc3f7", fontFamily: "monospace" }}>P</span><span>Paint mode</span>
            <span style={{ color: "#4fc3f7", fontFamily: "monospace" }}>E</span><span>Erase mode</span>
            <span style={{ color: "#4fc3f7", fontFamily: "monospace" }}>V</span><span>Place mode</span>
            <span style={{ color: "#4fc3f7", fontFamily: "monospace" }}>R</span><span>Rotate selected 15°</span>
            <span style={{ color: "#4fc3f7", fontFamily: "monospace" }}>Del</span><span>Delete selected</span>
            <span style={{ color: "#4fc3f7", fontFamily: "monospace" }}>[1-9]</span><span>Select catalog item</span>
            <span style={{ color: "#4fc3f7", fontFamily: "monospace" }}>?</span><span>Toggle this help</span>
          </div>
          <div style={{ marginTop: 12, color: "var(--muted-fg)", fontSize: 10 }}>Click anywhere to close</div>
        </div>
      </div>}
    </div>
  )
}

function Slider8({ label, value, min, max, step, onChange }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void }) {
  return (<div style={{ display: "flex", alignItems: "center", gap: 3, marginBottom: 3 }}>
    <span style={{ fontSize: 8, color: "var(--muted-fg)", width: 12 }}>{label}</span>
    <input type="range" min={min} max={max} step={step} value={value} onChange={e=>onChange(Number(e.target.value))}
      style={{ flex: 1, height: 2, accentColor: "#4fc3f7", cursor: "pointer" }} />
    <span style={{ fontSize: 8, color: "var(--muted-fg)", width: 24, textAlign: "right" }}>{value}{label==="R" ? "\u00b0" : ""}</span>
  </div>)
}
