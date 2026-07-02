/**
 * SceneEditor — 2D floor-plan grid + 3D preview.
 *
 * Paint cells to define room shape, then place furniture from the catalog.
 * Export saves the grid + items as JSON.
 */
import { useState, useCallback, useMemo } from "react"
import { Canvas } from "@react-three/fiber"
import { OrbitControls, ContactShadows } from "@react-three/drei"
import { Furniture } from "../components/Furniture"
import { GRID, gridToWorld } from "../components/GridConfig"
import { FURNI } from "../data/furniture-catalog"

type CellType = "empty" | "floor" | "wall"
type Tool = "floor" | "wall" | "erase" | "place"

const W = GRID.ROOM_W  // 14
const D = GRID.ROOM_D  // 12
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
    for (let x = 0; x < W; x++) {
      // Default: a central room block 10×8
      row.push(x >= 2 && x < 12 && z >= 2 && z < 10 ? "floor" : "empty")
    }
    g.push(row)
  }
  return g
}

// ── 2D grid cell ──
function Cell({
  type, hasItem, selected, onClick }: {
  type: CellType; hasItem: boolean; selected: boolean; onClick: () => void
}) {
  const bg = type === "wall" ? "#4a4a5a"
    : type === "floor" ? "#2a3a2a"
    : "#1a1a22"
  const border = selected ? "#4fc3f7" : type === "empty" ? "#222" : "#3a3a4a"
  return (
    <div onClick={onClick}
      style={{
        width: "100%", aspectRatio: "1", background: bg, border: hasItem ? "2px solid #4fc3f7" : `1px solid ${border}`,
        borderRadius: 1, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 10, transition: "background 0.1s",
      }}>
      {hasItem ? "⬡" : ""}
    </div>
  )
}

// ── 3D preview ──
function Preview({ grid, items }: { grid: CellType[][]; items: PlacedItem[] }) {
  const walls = useMemo(() => {
    const w: { x: number; z: number; w: number; d: number }[] = []
    for (let z = 0; z < D; z++) {
      for (let x = 0; x < W; x++) {
        if (grid[z][x] === "wall") w.push({ x, z, w: 1, d: 1 })
      }
    }
    return w
  }, [grid])

  return (
    <>
      <ambientLight intensity={0.5} />
      <directionalLight position={[5, 8, 5]} intensity={0.6} castShadow />
      <hemisphereLight args={["#e8d8c8", "#c8d8e0", 0.3]} />
      {/* Floor */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]} receiveShadow>
        <planeGeometry args={[GRID.W, GRID.D]} />
        <meshStandardMaterial color="#2a3a2a" roughness={0.9} />
      </mesh>
      {/* Walls */}
      {walls.map((w, i) => (
        <mesh key={i} position={[gridToWorld({ gx: w.x, gz: w.z }, 0)[0], 1.5, gridToWorld({ gx: w.x, gz: w.z }, 0)[2]]}
          castShadow receiveShadow>
          <boxGeometry args={[GRID.UNIT, 3, GRID.UNIT]} />
          <meshStandardMaterial color="#4a4a5a" roughness={0.8} />
        </mesh>
      ))}
      {/* Furniture */}
      {items.map((item, i) => {
        const def = FURNI.find((f) => f.id === item.id)
        if (!def) return null
        return (
          <Furniture key={i} gx={item.gx} gz={item.gz} rotation={item.rotation}>
            {def.render({ gx: item.gx, gz: item.gz })}
          </Furniture>
        )
      })}
      <ContactShadows position={[0, 0, 0]} opacity={0.2} scale={7} blur={2} far={2} />
    </>
  )
}

// ── Component ──
export default function SceneEditor() {
  const [grid, setGrid] = useState<CellType[][]>(initGrid)
  const [items, setItems] = useState<PlacedItem[]>([])
  const [selectedItem, setSelectedItem] = useState(-1)
  const [tool, setTool] = useState<Tool>("floor")
  const [placeId, setPlaceId] = useState("bed")
  const [tab, setTab] = useState<"plan" | "3d">("plan")

  const cycleCell = useCallback((gz: number, gx: number) => {
    setGrid((prev) => {
      const g = prev.map((r) => [...r])
      const cur = g[gz][gx]
      const idx = CYCLE.indexOf(cur)
      g[gz][gx] = CYCLE[(idx + 1) % CYCLE.length]
      return g
    })
  }, [])

  const paintCell = useCallback((gz: number, gx: number) => {
    if (tool === "erase") {
      setGrid((prev) => { const g = prev.map((r) => [...r]); g[gz][gx] = "empty"; return g })
    } else if (tool === "floor" || tool === "wall") {
      setGrid((prev) => { const g = prev.map((r) => [...r]); g[gz][gx] = tool; return g })
    } else if (tool === "place") {
      if (grid[gz][gx] !== "floor") return
      setItems((prev) => [...prev, { id: placeId, gx, gz, rotation: 0 }])
    }
  }, [tool, placeId, grid])

  const handleExport = () => {
    const blob = new Blob([JSON.stringify({
      grid: grid.map((r) => r.join("")),
      items,
    }, null, 2)], { type: "application/json" })
    const a = document.createElement("a")
    a.href = URL.createObjectURL(blob); a.download = "scene.json"; a.click()
    URL.revokeObjectURL(a.href)
  }


  return (
    <div style={{ display: "flex", height: "100%", fontFamily: "system-ui", background: "#12121e", color: "#ccc" }}>
      {/* Catalog sidebar */}
      <div style={{ width: 140, background: "#1a1a2e", borderRight: "1px solid #2a2a35", display: "flex", flexDirection: "column", overflow: "hidden", flexShrink: 0 }}>
        <div style={{ padding: "5px 6px", fontSize: 9, color: "#666", fontWeight: 600, borderBottom: "1px solid #2a2a35" }}>CATALOG</div>
        <div style={{ flex: 1, overflow: "auto", padding: 4 }}>
          {FURNI.map((f) => (
            <button key={f.id} onClick={() => { setPlaceId(f.id); setTool("place") }}
              style={{
                display: "flex", alignItems: "center", gap: 4, width: "100%", padding: "4px 6px", marginBottom: 2,
                borderRadius: 4, border: `1px solid ${placeId === f.id && tool === "place" ? "#4fc3f7" : "transparent"}`,
                background: placeId === f.id && tool === "place" ? "#4fc3f718" : "transparent",
                cursor: "pointer", textAlign: "left", fontSize: 9, color: "#ccc",
              }}>
              <span>{ICONS[f.id] ?? "▣"}</span>
              <span>{f.name}</span>
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
        {/* Toolbar */}
        <div style={{ display: "flex", alignItems: "center", gap: 3, padding: "3px 8px", background: "#16161e", borderBottom: "1px solid #2a2a35", fontSize: 9, flexShrink: 0 }}>
          <button onClick={() => setTab("plan")} style={{ padding: "2px 8px", borderRadius: 3, border: "none", cursor: "pointer", fontSize: 9, fontWeight: tab === "plan" ? 600 : 400, background: tab === "plan" ? "#4fc3f722" : "transparent", color: tab === "plan" ? "#4fc3f7" : "#666" }}>Floor Plan</button>
          <button onClick={() => setTab("3d")} style={{ padding: "2px 8px", borderRadius: 3, border: "none", cursor: "pointer", fontSize: 9, fontWeight: tab === "3d" ? 600 : 400, background: tab === "3d" ? "#4fc3f722" : "transparent", color: tab === "3d" ? "#4fc3f7" : "#666" }}>3D</button>
          <span style={{ color: "#333", margin: "0 4px" }}>|</span>
          {(["floor", "wall", "erase", "place"] as Tool[]).map((t) => (
            <button key={t} onClick={() => setTool(t)}
              style={{
                padding: "2px 8px", borderRadius: 3, border: `1px solid ${tool === t ? "#4fc3f7" : "#333"}`, cursor: "pointer", fontSize: 9,
                background: tool === t ? "#4fc3f722" : "transparent", color: tool === t ? "#4fc3f7" : "#888",
              }}>
              {t === "floor" ? "▣ Floor" : t === "wall" ? "█ Wall" : t === "erase" ? "✕ Erase" : `⬡ ${ICONS[placeId] ?? ""}`}
            </button>
          ))}
          <span style={{ flex: 1 }} />
          <span style={{ color: "#555", fontSize: 8 }}>{items.length} items</span>
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflow: "auto", display: "flex", alignItems: "center", justifyContent: "center", padding: 10 }}>
          {tab === "plan" ? (
            <div style={{ display: "grid", gridTemplateColumns: `repeat(${W}, 24px)`, gap: 0 }}>
              {(grid as CellType[][]).flatMap((row, gz) =>
                row.map((cell, gx) => (
                  <Cell key={`${gz}-${gx}`}
                    type={cell}
                    hasItem={items.some((i) => i.gx === gx && i.gz === gz)}
                    selected={items[selectedItem]?.gx === gx && items[selectedItem]?.gz === gz}
                    onClick={() => tool === "place" ? paintCell(gz, gx) : cycleCell(gz, gx)}
                  />
                ))
              )}
            </div>
          ) : (
            <div style={{ width: "100%", maxWidth: 500, aspectRatio: `${W}/${D}`, position: "relative" }}>
              <Canvas orthographic camera={{ position: [0, 10, 8], zoom: 40, near: -10, far: 20 }}
                shadows style={{ width: "100%", height: "100%", background: "#0d0d12", borderRadius: 8 }}>
                <Preview grid={grid as CellType[][]} items={items} />
                <OrbitControls enableRotate enableZoom enablePan zoomSpeed={0.8} panSpeed={0.4} minPolarAngle={0.5} maxPolarAngle={1.2} target={[0, 0.4, 0]} />
              </Canvas>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
