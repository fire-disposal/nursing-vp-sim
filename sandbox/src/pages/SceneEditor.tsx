/**
 * SceneEditor — 2D floor-plan grid + 3D preview.
 *
 * Paint cells to define room shape, place furniture, select to adjust.
 */
import { useState, useCallback, useMemo } from "react"
import { Canvas } from "@react-three/fiber"
import { OrbitControls, ContactShadows } from "@react-three/drei"
import { Furniture } from "../components/Furniture"
import { GRID, gridToWorld } from "../components/GridConfig"
import { FURNI } from "../data/furniture-catalog"

type CellType = "empty" | "floor" | "wall"
type Tool = "floor" | "wall" | "erase" | "place"

const W = GRID.ROOM_W
const D = GRID.ROOM_D
const CYCLE: CellType[] = ["empty", "floor", "wall", "floor"]

interface PlacedItem { id: string; gx: number; gz: number; rotation: number }

const ICONS: Record<string, string> = {
  bed: "\u{1F6CF}", patient: "\u{1F9D1}", iv: "\u{1F489}",
  monitor: "\u{1F5A5}", chair: "\u{1FA91}", plant: "\u{1F33F}",
  cabinet: "\u{1F5C4}", bedside: "\u{1FA91}",
}

function initGrid(): CellType[][] {
  const g: CellType[][] = []
  for (let z = 0; z < D; z++) {
    const row: CellType[] = []
    for (let x = 0; x < W; x++) row.push(x >= 2 && x < 12 && z >= 2 && z < 10 ? "floor" : "empty")
    g.push(row)
  }
  return g
}

function Cell({ type, hasItem, icon, selected, onClick }: { type: CellType; hasItem: boolean; icon: string; selected: boolean; onClick: () => void }) {
  const bg = type === "wall" ? "#4a4a5a" : type === "floor" ? "#2a3a2a" : "#1a1a22"
  const border = selected ? "#4fc3f7" : type === "empty" ? "#222" : "#3a3a4a"
  return (
    <div onClick={onClick}
      style={{ width: "100%", aspectRatio: "1", background: bg, border: hasItem ? `2px solid ${selected ? "#4fc3f7" : "#5a8"}` : `1px solid ${border}`, borderRadius: 1, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10 }}>
      {hasItem ? icon : ""}
    </div>
  )
}

function Preview({ grid, items, selectedIdx }: { grid: CellType[][]; items: PlacedItem[]; selectedIdx: number }) {
  const walls = useMemo(() => {
    const w: { x: number; z: number }[] = []
    for (let z = 0; z < D; z++) for (let x = 0; x < W; x++) if (grid[z][x] === "wall") w.push({ x, z })
    return w
  }, [grid])
  return (<>
    <ambientLight intensity={0.5} />
    <directionalLight position={[5, 8, 5]} intensity={0.6} castShadow />
    <hemisphereLight args={["#e8d8c8", "#c8d8e0", 0.3]} />
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]} receiveShadow>
      <planeGeometry args={[GRID.W, GRID.D]} /><meshStandardMaterial color="#2a3a2a" roughness={0.9} />
    </mesh>
    {walls.map((w, i) => (
      <mesh key={i} position={[gridToWorld({ gx: w.x, gz: w.z }, 0)[0], 1.5, gridToWorld({ gx: w.x, gz: w.z }, 0)[2]]} castShadow receiveShadow>
        <boxGeometry args={[GRID.UNIT, 3, GRID.UNIT]} /><meshStandardMaterial color="#4a4a5a" roughness={0.8} />
      </mesh>
    ))}
    {items.map((item, i) => {
      const def = FURNI.find((f) => f.id === item.id)
      if (!def) return null
      const sel = i === selectedIdx
      return (<group key={`${item.gx}-${item.gz}-${item.id}`}>
        <Furniture gx={item.gx} gz={item.gz} rotation={item.rotation}>
          {def.render({ gx: item.gx, gz: item.gz })}
        </Furniture>
        {sel && <mesh position={[gridToWorld({ gx: item.gx, gz: item.gz }, 0)[0], 2.8, gridToWorld({ gx: item.gx, gz: item.gz }, 0)[2]]}>
          <boxGeometry args={[GRID.UNIT * 1.1, 0.05, GRID.UNIT * 1.1]} />
          <meshBasicMaterial color="#4fc3f7" transparent opacity={0.3} />
        </mesh>}
      </group>)
    })}
    <ContactShadows position={[0, 0, 0]} opacity={0.2} scale={7} blur={2} far={2} />
  </>)
}

export default function SceneEditor() {
  const [grid, setGrid] = useState<CellType[][]>(initGrid)
  const [items, setItems] = useState<PlacedItem[]>([])
  const [selectedIdx, setSelectedIdx] = useState(-1)
  const [tool, setTool] = useState<Tool>("floor")
  const [placeId, setPlaceId] = useState("bed")
  const [tab, setTab] = useState<"plan" | "3d">("plan")

  const sel = selectedIdx >= 0 && selectedIdx < items.length ? items[selectedIdx] : null

  const cycleCell = useCallback((gz: number, gx: number) => {
    setGrid((prev) => { const g = prev.map((r) => [...r]); const i = CYCLE.indexOf(g[gz][gx]); g[gz][gx] = CYCLE[(i + 1) % CYCLE.length]; return g })
  }, [])

  const handleCellClick = useCallback((gz: number, gx: number) => {
    if (tool === "place") {
      if (grid[gz][gx] !== "floor") return
      setItems((prev) => [...prev, { id: placeId, gx, gz, rotation: 0 }])
      setSelectedIdx(items.length)
    } else if (tool === "erase") {
      setItems((prev) => prev.filter((item) => !(item.gx === gx && item.gz === gz)))
      setGrid((prev) => { const g = prev.map((r) => [...r]); g[gz][gx] = "empty"; return g })
    } else {
      // Click on item -> select it; click on cell -> cycle
      const hit = items.findIndex((item) => item.gx === gx && item.gz === gz)
      if (hit >= 0) { setSelectedIdx(hit); return }
      cycleCell(gz, gx)
    }
  }, [tool, placeId, grid, items, cycleCell])

  const updateItem = useCallback((idx: number, patch: Partial<PlacedItem>) => {
    setItems((prev) => prev.map((item, i) => i === idx ? { ...item, ...patch } : item))
  }, [])

  const deleteItem = useCallback((idx: number) => {
    setItems((prev) => prev.filter((_, i) => i !== idx))
    setSelectedIdx(-1)
  }, [])

  const handleExport = () => {
    const blob = new Blob([JSON.stringify({ grid: grid.map((r) => r.join("")), items }, null, 2)], { type: "application/json" })
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "scene.json"; a.click()
    URL.revokeObjectURL(a.href)
  }

  return (
    <div style={{ display: "flex", height: "100%", fontFamily: "system-ui", background: "#12121e", color: "#ccc" }}>
      {/* Catalog sidebar */}
      <div style={{ width: 130, background: "#1a1a2e", borderRight: "1px solid #2a2a35", display: "flex", flexDirection: "column", flexShrink: 0 }}>
        <div style={{ padding: "5px 6px", fontSize: 9, color: "#666", fontWeight: 600, borderBottom: "1px solid #2a2a35" }}>CATALOG</div>
        <div style={{ flex: 1, overflow: "auto", padding: 4 }}>
          {FURNI.map((f) => (
            <button key={f.id} onClick={() => { setPlaceId(f.id); setTool("place") }}
              style={{ display: "flex", alignItems: "center", gap: 4, width: "100%", padding: "4px 6px", marginBottom: 2, borderRadius: 4,
                border: `1px solid ${placeId === f.id && tool === "place" ? "#4fc3f7" : "transparent"}`,
                background: placeId === f.id && tool === "place" ? "#4fc3f718" : "transparent", cursor: "pointer", textAlign: "left", fontSize: 9, color: "#ccc" }}>
              <span>{ICONS[f.id] ?? "▣"}</span><span>{f.name}</span>
            </button>
          ))}
        </div>
        <button onClick={handleExport}
          style={{ padding: "5px", margin: 4, borderRadius: 4, border: "1px solid #4fc3f7", background: "#4fc3f722", color: "#4fc3f7", cursor: "pointer", fontSize: 9 }}>
          Export
        </button>
      </div>

      {/* Main area */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 3, padding: "3px 8px", background: "#16161e", borderBottom: "1px solid #2a2a35", fontSize: 9, flexShrink: 0 }}>
          <button onClick={() => setTab("plan")} style={{ padding: "2px 8px", borderRadius: 3, border: "none", cursor: "pointer", fontSize: 9, fontWeight: tab === "plan" ? 600 : 400, background: tab === "plan" ? "#4fc3f722" : "transparent", color: tab === "plan" ? "#4fc3f7" : "#666" }}>Plan</button>
          <button onClick={() => setTab("3d")} style={{ padding: "2px 8px", borderRadius: 3, border: "none", cursor: "pointer", fontSize: 9, fontWeight: tab === "3d" ? 600 : 400, background: tab === "3d" ? "#4fc3f722" : "transparent", color: tab === "3d" ? "#4fc3f7" : "#666" }}>3D</button>
          <span style={{ color: "#333", margin: "0 4px" }}>|</span>
          {(["floor", "wall", "erase", "place"] as Tool[]).map((t) => (
            <button key={t} onClick={() => setTool(t)}
              style={{ padding: "2px 8px", borderRadius: 3, border: `1px solid ${tool === t ? "#4fc3f7" : "#333"}`, cursor: "pointer", fontSize: 9,
                background: tool === t ? "#4fc3f722" : "transparent", color: tool === t ? "#4fc3f7" : "#888" }}>
              {t === "floor" ? "▣ Floor" : t === "wall" ? "█ Wall" : t === "erase" ? "✕ Erase" : `⬡ ${ICONS[placeId] ?? ""}`}
            </button>
          ))}
          <span style={{ flex: 1 }} />
          <span style={{ color: "#555", fontSize: 8 }}>{items.length} items</span>
        </div>

        <div style={{ flex: 1, overflow: "auto", display: "flex", alignItems: "center", justifyContent: "center", padding: 10 }}>
          {tab === "plan" ? (
            <div style={{ display: "grid", gridTemplateColumns: `repeat(${W}, 24px)`, gap: 0 }}>
              {(grid as CellType[][]).flatMap((row, gz) =>
                row.map((cell, gx) => (
                  <Cell key={`${gz}-${gx}`}
                    type={cell}
                    hasItem={items.some((i) => i.gx === gx && i.gz === gz)}
                    icon={ICONS[items.find((i) => i.gx === gx && i.gz === gz)?.id ?? ""] ?? "⬡"}
                    selected={sel?.gx === gx && sel?.gz === gz}
                    onClick={() => handleCellClick(gz, gx)}
                  />
                ))
              )}
            </div>
          ) : (
            <div style={{ width: "100%", maxWidth: 500, aspectRatio: `${W}/${D}`, position: "relative" }}>
              <Canvas orthographic camera={{ position: [0, 10, 8], zoom: 40, near: -10, far: 20 }}
                shadows style={{ width: "100%", height: "100%", background: "#0d0d12", borderRadius: 8 }}>
                <Preview grid={grid as CellType[][]} items={items} selectedIdx={selectedIdx} />
                <OrbitControls enableRotate enableZoom enablePan zoomSpeed={0.8} panSpeed={0.4} minPolarAngle={0.5} maxPolarAngle={1.2} target={[0, 0.4, 0]} />
              </Canvas>
            </div>
          )}
        </div>
      </div>

      {/* Right panel — item list + properties */}
      <div style={{ width: 160, background: "#1a1a2e", borderLeft: "1px solid #2a2a35", display: "flex", flexDirection: "column", flexShrink: 0 }}>
        <div style={{ padding: "5px 6px", fontSize: 9, color: "#666", fontWeight: 600, borderBottom: "1px solid #2a2a35" }}>ITEMS ({items.length})</div>
        <div style={{ flex: 1, overflow: "auto", padding: 4, fontSize: 9 }}>
          {items.map((item, i) => {
            const def = FURNI.find((f) => f.id === item.id)
            return (
              <div key={i} onClick={() => setSelectedIdx(i)}
                style={{ display: "flex", alignItems: "center", gap: 3, padding: "3px 5px", borderRadius: 3, marginBottom: 2, cursor: "pointer", background: i === selectedIdx ? "#4fc3f718" : "transparent", border: i === selectedIdx ? "1px solid #4fc3f7" : "1px solid transparent" }}>
                <span>{ICONS[item.id] ?? "▣"}</span>
                <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis" }}>{def?.name ?? item.id}</span>
                <span style={{ color: "#555", fontSize: 8 }}>{item.gx},{item.gz}</span>
              </div>
            )
          })}
          {items.length === 0 && <div style={{ color: "#555", textAlign: "center", padding: "12px 0" }}>No items placed</div>}
        </div>

        {sel && (
          <div style={{ borderTop: "1px solid #2a2a35", padding: "6px" }}>
            <div style={{ fontSize: 8, color: "#666", fontWeight: 600, marginBottom: 3 }}>PROPERTIES</div>
            <div style={{ display: "flex", alignItems: "center", gap: 3, marginBottom: 3 }}>
              <span style={{ fontSize: 8, color: "#888", width: 12 }}>R</span>
              <input type="range" min={0} max={360} step={15} value={sel.rotation}
                onChange={(e) => updateItem(selectedIdx, { rotation: Number(e.target.value) })}
                style={{ flex: 1, height: 2, accentColor: "#4fc3f7", cursor: "pointer" }} />
              <span style={{ fontSize: 8, color: "#888", width: 20, textAlign: "right" }}>{sel.rotation}°</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 3, marginBottom: 3 }}>
              <span style={{ fontSize: 8, color: "#888", width: 12 }}>X</span>
              <input type="range" min={0} max={W - 1} step={1} value={sel.gx}
                onChange={(e) => updateItem(selectedIdx, { gx: Number(e.target.value) })}
                style={{ flex: 1, height: 2, accentColor: "#4fc3f7", cursor: "pointer" }} />
              <span style={{ fontSize: 8, color: "#888", width: 20, textAlign: "right" }}>{sel.gx}</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 3, marginBottom: 4 }}>
              <span style={{ fontSize: 8, color: "#888", width: 12 }}>Z</span>
              <input type="range" min={0} max={D - 1} step={1} value={sel.gz}
                onChange={(e) => updateItem(selectedIdx, { gz: Number(e.target.value) })}
                style={{ flex: 1, height: 2, accentColor: "#4fc3f7", cursor: "pointer" }} />
              <span style={{ fontSize: 8, color: "#888", width: 20, textAlign: "right" }}>{sel.gz}</span>
            </div>
            <button onClick={() => deleteItem(selectedIdx)}
              style={{ width: "100%", padding: "3px 0", borderRadius: 3, border: "1px solid #e74c3c44", background: "#e74c3c18", color: "#e74c3c", cursor: "pointer", fontSize: 8 }}>
              Delete
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
