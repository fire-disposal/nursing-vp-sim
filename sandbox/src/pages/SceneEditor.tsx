import { useState, useCallback, useRef, useMemo } from "react"
import { Canvas } from "@react-three/fiber"
import { OrbitControls, ContactShadows, Edges } from "@react-three/drei"
import { ProceduralRoom } from "../components/ProceduralRoom"
import type { Cell } from "../components/ProceduralRoom"
import { Furniture } from "../components/Furniture"
import { GRID, gridCells, gridToWorld } from "../components/GridConfig"
import { FURNI } from "../data/furniture-catalog"

interface PlacedItem {
  id: string
  gx: number
  gz: number
  rotation: number
}

const INITIAL_CENTER = { gx: 6, gz: 6 }

const CATS = ["", ...new Set(FURNI.map((f) => f.category))]

const ICONS: Record<string, string> = {
  bed: "\u{1F6CF}", patient: "\u{1F9D1}", iv: "\u{1F489}",
  monitor: "\u{1F5A5}", chair: "\u{1FA91}", plant: "\u{1F33F}",
  cabinet: "\u{1F5C4}", bedside: "\u{1FA91}",
}

let nextId = 1

function Viewport({ items, selectedIndex, onSelect, onDeselect }: {
  items: PlacedItem[]
  selectedIndex: number | null
  onSelect: (i: number) => void
  onDeselect: () => void
}) {
  const cells: Cell[] = useMemo(() => gridCells().map((c) => ({ gx: c.gx, gz: c.gz })), [])

  return (
    <>
      <ambientLight intensity={0.5} />
      <directionalLight position={[5, 8, 5]} intensity={0.7} castShadow shadow-mapSize-width={1024} shadow-mapSize-height={1024} />
      <directionalLight position={[-3, 3, 2]} intensity={0.3} />
      <hemisphereLight args={["#e8d8c8", "#c8d8e0", 0.3]} />

      <ProceduralRoom
        cells={cells}
        unit={GRID.UNIT}
        wallHeight={GRID.WALL_H}
        wallColor="var(--muted)"
        floorColor="var(--bg)"
      />

      {items.map((it, i) => {
        const def = FURNI.find((f) => f.id === it.id)
        if (!def) return null
        const worldPos = gridToWorld({ gx: it.gx, gz: it.gz }, 0)
        const selected = selectedIndex === i
        return (
          <group key={i} onClick={(e) => { e.stopPropagation(); onSelect(i) }}>
            <Furniture gx={it.gx} gz={it.gz} rotation={it.rotation}>
              {def.render({ gx: it.gx, gz: it.gz })}
            </Furniture>
            {selected && (
              <mesh position={[worldPos[0], 0.02, worldPos[2]]}>
                <boxGeometry args={[GRID.UNIT * 0.9, 0.02, GRID.UNIT * 0.9]} />
                <meshBasicMaterial color="#facc15" transparent opacity={0.25} />
                <Edges color="#facc15" />
              </mesh>
            )}
          </group>
        )
      })}

      <mesh onClick={onDeselect} position={[0, -0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[20, 20]} />
        <meshBasicMaterial transparent opacity={0} />
      </mesh>

      <ContactShadows position={[0, 0.001, 0]} opacity={0.15} scale={10} blur={2} far={2} />
    </>
  )
}

export default function SceneEditor() {
  const [items, setItems] = useState<PlacedItem[]>([])
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)
  const [filter, setFilter] = useState("")
  const [cat, setCat] = useState("")
  const fileRef = useRef<HTMLInputElement>(null)
  const loadRef = useRef<HTMLInputElement>(null)

  const filtered = filter
    ? FURNI.filter((f) => f.name.includes(filter) || f.tags.some((t) => t.includes(filter)))
    : FURNI

  const selectedItem = selectedIndex !== null ? items[selectedIndex] ?? null : null

  const addItem = useCallback((furniId: string) => {
    setItems((prev) => [...prev, { id: furniId, gx: INITIAL_CENTER.gx, gz: INITIAL_CENTER.gz, rotation: 0 }])
    nextId++
  }, [])

  const updateItem = useCallback((i: number, patch: Partial<PlacedItem>) => {
    setItems((prev) => {
      const next = [...prev]
      if (next[i]) next[i] = { ...next[i], ...patch }
      return next
    })
  }, [])

  const deleteItem = useCallback((i: number) => {
    setItems((prev) => {
      const next = prev.filter((_, idx) => idx !== i)
      return next
    })
    setSelectedIndex((prev) => {
      if (prev === null) return null
      if (prev === i) return null
      return prev > i ? prev - 1 : prev
    })
  }, [])

  const handleSave = useCallback(() => {
    const data = { name: "Scene", items }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = "scene.json"
    a.click()
    URL.revokeObjectURL(url)
  }, [items])

  const handleLoad = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target?.result as string)
        if (Array.isArray(data?.items)) {
          setItems(data.items)
          setSelectedIndex(null)
        }
      } catch { /* ignore invalid JSON */ }
    }
    reader.readAsText(file)
    e.target.value = ""
  }, [])

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "var(--bg)", color: "var(--fg)", fontFamily: "system-ui" }}>
      {/* ── Top bar ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 10px", background: "var(--card)", borderBottom: "1px solid var(--border)", fontSize: 10, flexShrink: 0 }}>
        <span style={{ fontWeight: 700, color: "var(--muted-fg)", letterSpacing: 0.5, fontSize: 10, marginRight: 4 }}>S/B</span>
        <span style={{ color: "var(--accent)", fontWeight: 600, fontSize: 11 }}>Scene Editor</span>
        <div style={{ flex: 1 }} />
        <button onClick={handleSave}
          style={{ padding: "2px 10px", background: "var(--accent)", border: "none", borderRadius: 4, color: "#fff", cursor: "pointer", fontSize: 9, fontWeight: 600 }}>
          Save
        </button>
        <button onClick={() => loadRef.current?.click()}
          style={{ padding: "2px 10px", background: "transparent", border: "1px solid var(--border)", borderRadius: 4, color: "var(--muted-fg)", cursor: "pointer", fontSize: 9 }}>
          Load
        </button>
        <input ref={loadRef} type="file" accept=".json" onChange={handleLoad} style={{ display: "none" }} />
        <span style={{ fontSize: 8, color: "var(--muted-fg)", opacity: 0.5, fontFamily: "monospace" }}>
          {items.length} item{items.length !== 1 ? "s" : ""}
        </span>
      </div>

      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        {/* ── LEFT: Catalog ── */}
        <div style={{ width: 180, background: "var(--card)", borderRight: "1px solid var(--border)", display: "flex", flexDirection: "column", overflow: "hidden", flexShrink: 0 }}>
          <div style={{ padding: "5px 6px", borderBottom: "1px solid var(--border)" }}>
            <input value={filter} onChange={(e) => setFilter(e.target.value)}
              placeholder="Search…"
              style={{ width: "100%", padding: "3px 6px", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 4, color: "var(--fg)", fontSize: 10, outline: "none" }}
            />
            <div style={{ display: "flex", gap: 2, marginTop: 4, flexWrap: "wrap" }}>
              {CATS.map((c) => (
                <button key={c} onClick={() => setCat(c)}
                  style={{
                    padding: "1px 5px", borderRadius: 3, border: `1px solid ${cat === c ? "var(--accent)" : "transparent"}`,
                    background: cat === c ? "color-mix(in srgb, var(--accent) 15%, transparent)" : "transparent",
                    color: cat === c ? "var(--accent)" : "var(--muted-fg)", cursor: "pointer", fontSize: 8, lineHeight: "14px",
                  }}>
                  {c || "All"}
                </button>
              ))}
            </div>
          </div>
          <div style={{ flex: 1, overflow: "auto", padding: "4px 6px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4, alignContent: "start" }}>
            {(cat ? filtered.filter((f) => f.category === cat) : filtered).map((f) => (
              <button key={f.id} onClick={() => addItem(f.id)}
                style={{
                  display: "flex", flexDirection: "column", alignItems: "center", gap: 2,
                  padding: "6px 4px", borderRadius: 5, border: "1px solid transparent",
                  background: "transparent", cursor: "pointer",
                }}>
                <div style={{ width: 40, height: 40, borderRadius: 4, background: f.thumb, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, opacity: 0.7 }}>
                  {ICONS[f.id] ?? "\u25A3"}
                </div>
                <span style={{ fontSize: 9, color: "var(--muted-fg)" }}>{f.name}</span>
              </button>
            ))}
          </div>
        </div>

        {/* ── 3D Viewport ── */}
        <div style={{ flex: 1, position: "relative" }}>
          <Canvas orthographic camera={{ position: [6, 5, 7], zoom: 40, near: 0.1, far: 30 }} shadows
            style={{ background: "var(--bg)" }}>
            <Viewport
              items={items}
              selectedIndex={selectedIndex}
              onSelect={setSelectedIndex}
              onDeselect={() => setSelectedIndex(null)}
            />
            <OrbitControls enableZoom enablePan enableRotate target={[0, 0.2, 0]}
              maxPolarAngle={Math.PI / 2.2} minZoom={15} maxZoom={80} />
          </Canvas>
        </div>
      </div>

      {/* ── Bottom bar ── */}
      <div style={{
        display: "flex", alignItems: "center", gap: 8,
        padding: "5px 10px", borderTop: "1px solid var(--border)",
        background: "var(--card)", fontSize: 10, flexShrink: 0, minHeight: 32,
      }}>
        {selectedItem ? (
          <>
            <span style={{ fontWeight: 600, color: "var(--accent)", minWidth: 60 }}>
              {FURNI.find((f) => f.id === selectedItem.id)?.name ?? selectedItem.id}
            </span>
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{ color: "var(--muted-fg)", fontSize: 9 }}>X</span>
              <input type="range" min={0} max={GRID.ROOM_W - 1} step={1} value={selectedItem.gx}
                onChange={(e) => updateItem(selectedIndex!, { gx: Number(e.target.value) })}
                style={{ width: 60, height: 3, accentColor: "var(--accent)", cursor: "pointer" }} />
              <span style={{ color: "var(--muted-fg)", fontFamily: "monospace", fontSize: 9, minWidth: 16 }}>{selectedItem.gx}</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{ color: "var(--muted-fg)", fontSize: 9 }}>Z</span>
              <input type="range" min={0} max={GRID.ROOM_D - 1} step={1} value={selectedItem.gz}
                onChange={(e) => updateItem(selectedIndex!, { gz: Number(e.target.value) })}
                style={{ width: 60, height: 3, accentColor: "var(--accent)", cursor: "pointer" }} />
              <span style={{ color: "var(--muted-fg)", fontFamily: "monospace", fontSize: 9, minWidth: 16 }}>{selectedItem.gz}</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{ color: "var(--muted-fg)", fontSize: 9 }}>Rot</span>
              <input type="range" min={0} max={360} step={1} value={selectedItem.rotation}
                onChange={(e) => updateItem(selectedIndex!, { rotation: Number(e.target.value) })}
                style={{ width: 80, height: 3, accentColor: "var(--accent)", cursor: "pointer" }} />
              <span style={{ color: "var(--muted-fg)", fontFamily: "monospace", fontSize: 9, minWidth: 24 }}>{selectedItem.rotation}°</span>
            </div>
            <div style={{ flex: 1 }} />
            <button onClick={() => deleteItem(selectedIndex!)}
              style={{ padding: "2px 10px", background: "#e74c3c22", border: "1px solid #e74c3c", borderRadius: 4, color: "#e74c3c", cursor: "pointer", fontSize: 9 }}>
              Delete
            </button>
            <button onClick={() => addItem(selectedItem.id)}
              style={{ padding: "2px 10px", background: "color-mix(in srgb, var(--accent) 15%, transparent)", border: "1px solid var(--accent)", borderRadius: 4, color: "var(--accent)", cursor: "pointer", fontSize: 9 }}>
              + Add
            </button>
          </>
        ) : (
          <span style={{ color: "var(--muted-fg)", opacity: 0.5 }}>
            Select an item in the 3D view or click a catalog item to add
          </span>
        )}
      </div>
    </div>
  )
}
