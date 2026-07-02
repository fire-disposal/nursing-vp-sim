/**
 * FurnitureLab — pick, preview, and calibrate furniture.
 *
 * ┌──────────────┬──────────────────────────────────────────┐
 * │  PICKER      │  INFO + PARAMS                           │
 * │  ┌──┐ ┌──┐   │  ┌────────────────────────────────────┐  │
 * │  │床│ │椅│   │  │  3D preview (grid + reference)     │  │
 * │  ├──┤ ├──┤   │  │                                    │  │
 * │  │患│ │输│   │  └────────────────────────────────────┘  │
 * │  │者│ │液│   │  ┌────────────────────────────────────┐  │
 * │  └──┘ └──┘   │  │  Translate  │ Rotate │ Scale       │  │
 * │  [search]     │  │  X: ═══●══  │ Y: ═══●══  │ ═══●══ │  │
 * └──────────────┴──────────────────────────────────────────┘
 */
import { useState, useCallback, useRef, useMemo, Suspense, useEffect } from "react"
import { Canvas } from "@react-three/fiber"
import { ContactShadows, Edges, OrbitControls, useGLTF } from "@react-three/drei"
import * as THREE from "three"
import type { FurniDef } from "../data/furniture-catalog"
import { FURNI } from "../data/furniture-catalog"
import { buildEntry, mergeEntry, getEntry, getAllEntries, toggleEnabled, deleteEntry } from "../data/furniture-registry"
import type { FurnitureEntry } from "../data/furniture-registry"
import { discoverModels, clearModelCache, type DiscoveredModel } from "../data/discover-models"

// ── Colour palette (light/dark aware) ──
function palette(dark: boolean) {
  return dark
    ? { bg: "#1a1a2a", panel: "#12121e", border: "#2a2a35", text: "#ccc", dim: "#666", accent: "#4fc3f7", canvas: "#1e1e28", watermark: "#fff2" }
    : { bg: "#e8e8ee", panel: "#fff", border: "#ddd", text: "#222", dim: "#888", accent: "#0288d1", canvas: "#ede8e2", watermark: "#0003" }
}

// ── Slider + number input ──
function SliderInput({ label, value, min, max, step, onChange, dark, log }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; dark: boolean; log?: boolean }) {
  const pal = palette(dark)
  const [edit, setEdit] = useState<string | null>(null)

  // Logarithmic transform: slider 0-100 ↔ actual value
  const sliderVal = log ? Math.round(50 + Math.log10(value) * 25) : ((value - min) / (max - min)) * 100
  const fromSlider = (s: number) => log ? Math.pow(10, (s - 50) / 25) : min + (s / 100) * (max - min)

  const display = edit ?? ""

  const commit = (v: string) => {
    const n = Number(v)
    if (!isNaN(n) && isFinite(n)) {
      onChange(Math.min(max, Math.max(min, log ? n : Math.round(n / step) * step)))
    }
    setEdit(null)
  }

  const displayVal = edit !== null ? edit : ""
  const displayPlaceholder = value.toFixed(log ? 3 : step < 0.1 ? 2 : 1)

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3, height: 22 }}>
      <span style={{ fontSize: 9, color: pal.dim, width: 20, flexShrink: 0 }}>{label}</span>
      <input type="range" min={0} max={100} step={1} value={Math.round(sliderVal)}
        onChange={(e) => onChange(fromSlider(Number(e.target.value)))}
        style={{ flex: 1, height: 3, accentColor: pal.accent, cursor: "pointer" }} />
      <input type="text" value={displayVal} placeholder={displayPlaceholder}
        onChange={(e) => setEdit(e.target.value)}
        onBlur={() => commit(edit ?? "")}
        onKeyDown={(e) => { if (e.key === "Enter") commit(edit ?? ""); if (e.key === "Escape") setEdit(null) }}
        style={{ width: 48, padding: "1px 4px", background: pal.bg, border: `1px solid ${edit ? pal.accent : pal.border}`, borderRadius: 3, color: pal.text, fontSize: 9, textAlign: "right", outline: "none", fontVariantNumeric: "tabular-nums" }} />
    </div>
  )
}

// ── JSON transform panel ──
function TransformJSON({ id, name, tx, ty, tz, rot, scale, glbName, glbHash, onApply, dark }: {
  id: string; name: string
  tx: number; ty: number; tz: number
  rot: number; scale: number
  glbName?: string | null
  glbHash?: string | null
  onApply: (v: { tx: number; ty: number; tz: number; rot: number; scale: number }) => void
  dark: boolean
}) {
  const pal = palette(dark)
  const [raw, setRaw] = useState("")
  const [err, setErr] = useState("")

  const obj: Record<string, unknown> = { id, name, tx: +tx.toFixed(2), ty: +ty.toFixed(2), tz: +tz.toFixed(2), rot, scale: +scale.toFixed(2) }
  if (glbName) obj.glb = glbName
  if (glbHash) obj.hash = glbHash
  const json = JSON.stringify(obj, null, 2)

  const copy = useCallback(() => {
    navigator.clipboard.writeText(json).catch(() => {})
  }, [json])

  const apply = useCallback(() => {
    try {
      const p = JSON.parse(raw)
      const v = {
        tx: typeof p.tx === "number" ? p.tx : tx,
        ty: typeof p.ty === "number" ? p.ty : ty,
        tz: typeof p.tz === "number" ? p.tz : tz,
        rot: typeof p.rot === "number" ? p.rot : rot,
        scale: typeof p.scale === "number" ? p.scale : scale,
      }
      onApply(v)
      setErr("")
    } catch { setErr("Invalid JSON") }
  }, [raw, tx, ty, tz, rot, scale, onApply])

  return (
    <div style={{ minWidth: 180, flex: 1 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
        <span style={{ fontSize: 9, color: pal.dim, fontWeight: 600 }}>TRANSFORM JSON</span>
        <button onClick={copy}
          style={{ padding: "1px 8px", background: "transparent", border: `1px solid ${pal.border}`, borderRadius: 3, color: pal.accent, cursor: "pointer", fontSize: 9 }}>
          Copy
        </button>
      </div>
      <pre style={{ margin: "0 0 4px 0", color: "#b0b8c0", fontSize: 9, fontFamily: "monospace", lineHeight: 1.4, whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
{json}
      </pre>
      <div style={{ display: "flex", gap: 3 }}>
        <input value={raw} onChange={(e) => setRaw(e.target.value)} placeholder="Paste JSON & Apply…"
          style={{ flex: 1, padding: "2px 6px", background: pal.bg, border: `1px solid ${err ? "#e74c3c" : pal.border}`, borderRadius: 3, color: pal.text, fontSize: 9, outline: "none" }}
        />
        <button onClick={apply} disabled={!raw}
          style={{ padding: "2px 8px", background: raw ? `${pal.accent}33` : pal.bg, border: `1px solid ${raw ? pal.accent : pal.border}`, borderRadius: 3, color: raw ? pal.accent : pal.dim, cursor: raw ? "pointer" : "default", fontSize: 9 }}>
          Apply
        </button>
      </div>
      {err && <div style={{ color: "#e74c3c", fontSize: 8, marginTop: 2 }}>{err}</div>}
    </div>
  )
}

// ── GLB model loader (inside Canvas + Suspense) — auto‑centers bottom to floor
function GLBScene({ url }: { url: string }) {
  const gltf = useGLTF(url)
  const { scene, offsetY } = useMemo(() => {
    const s = gltf.scene.clone(true)
    s.traverse((child: any) => {
      if (child.isMesh) { child.castShadow = true; child.receiveShadow = true }
    })
    const box = new THREE.Box3().setFromObject(s)
    const oy = box.min.y < 0 ? -box.min.y : 0
    return { scene: s, offsetY: oy }
  }, [gltf.scene])
  return <primitive object={scene} position={[0, offsetY, 0]} />
}

// ── 3D preview ──
function Preview({ def, tx, ty, tz, rot, sc, glbUrl, dark }: {
  def: FurniDef; tx: number; ty: number; tz: number; rot: number; sc: number; glbUrl?: string; dark: boolean
}) {
  const pal = palette(dark)
  return (
    <>
      <ambientLight intensity={0.5} />
      <directionalLight position={[3,5,3]} intensity={0.7} castShadow shadow-mapSize-width={1024} shadow-mapSize-height={1024} />
      <directionalLight position={[-2,2,1]} intensity={0.3} />
      <hemisphereLight args={["#e8d8c8","#c8d8e0",0.3]} />

      {/* Ground */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
        <planeGeometry args={[3, 3]} />
        <meshStandardMaterial color="#ede8e2" roughness={0.95} />
      </mesh>

      {/* Grid — 0.5m spacing */}
      <gridHelper args={[3, 3, "#ccc", "#e0e0e0"]} position={[0, 0.002, 0]} />

      {/* Origin crosshair */}
      <mesh position={[0, 0.003, 0]}>
        <planeGeometry args={[0.08, 0.08]} />
        <meshBasicMaterial color={pal.accent} transparent opacity={0.25} side={2} />
      </mesh>

      {/* Reference box + colour axes — 1m wireframe cube, bottom centre = origin */}
      {/*
        Box centre: [0, 0.5, 0]  →  bottom face centre at origin
        Three axis arrows from the bottom‑left‑front corner showing 1m edge directions.
        Axes are part of the cube (scale/direction reference), NOT at the origin.
      */}
      <group position={[0, 0.5, 0]}>
        <mesh>
          <boxGeometry args={[1, 1, 1]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
          <Edges color="#999" transparent opacity={0.3} />
        </mesh>
        {/* Corner = bottom‑left‑front: offset [-0.5, -0.5, -0.5] from centre */}
        <group position={[-0.5, -0.5, -0.5]}>
          {/* X edge — red (+X) */}
          <mesh rotation={[0, 0, -Math.PI / 2]} position={[0.5, 0, 0]}>
            <cylinderGeometry args={[0.006, 0.006, 1.0]} />
            <meshStandardMaterial color="#e74c3c" />
          </mesh>
          <mesh rotation={[0, 0, -Math.PI / 2]} position={[0.97, 0, 0]}>
            <coneGeometry args={[0.025, 0.06, 6]} />
            <meshStandardMaterial color="#e74c3c" />
          </mesh>
          {/* Y edge — green (+Y) */}
          <mesh position={[0, 0.5, 0]}>
            <cylinderGeometry args={[0.006, 0.006, 1.0]} />
            <meshStandardMaterial color="#2ecc71" />
          </mesh>
          <mesh position={[0, 0.97, 0]}>
            <coneGeometry args={[0.025, 0.06, 6]} />
            <meshStandardMaterial color="#2ecc71" />
          </mesh>
          {/* Z edge — blue (+Z) */}
          <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0, 0.5]}>
            <cylinderGeometry args={[0.006, 0.006, 1.0]} />
            <meshStandardMaterial color="#3498db" />
          </mesh>
          <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0, 0.97]}>
            <coneGeometry args={[0.025, 0.06, 6]} />
            <meshStandardMaterial color="#3498db" />
          </mesh>
        </group>
      </group>

      {/* Furniture */}
      <group position={[tx, ty, tz]} rotation={[0, rot, 0]} scale={[sc, sc, sc]}>
        {glbUrl
          ? <Suspense fallback={null}>
              <GLBScene url={glbUrl} />
            </Suspense>
          : def.render({ gx: 0, gz: 0 })
        }
      </group>

      <ContactShadows position={[0, 0.001, 0]} opacity={0.2} scale={3} blur={1.5} far={1} />
    </>
  )
}

// ── File → hash helper ──
async function fileToHash(file: File): Promise<string> {
  const buf = await file.arrayBuffer()
  const hash = await crypto.subtle.digest("SHA-256", buf)
  const hex = Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("")
  return "sha256:" + hex
}

// ── Component ──
export default function FurnitureLab({ dark: explicitDark }: { dark?: boolean }) {
  const [dark, setDark] = useState(explicitDark ?? document.documentElement.classList.contains("dark"))
  useEffect(() => {
    if (explicitDark !== undefined) return
    const obs = new MutationObserver(() => setDark(document.documentElement.classList.contains("dark")))
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] })
    return () => obs.disconnect()
  }, [explicitDark])
  const pal = palette(dark)
  const [idx, setIdx] = useState(0)
  const [filter, setFilter] = useState("")
  const [tx, setTx] = useState(0); const [ty, setTy] = useState(0); const [tz, setTz] = useState(0)
  const [rot, setRot] = useState(0); const [sc, setSc] = useState(1)
  const [glbUrl, setGlbUrl] = useState<string | null>(null)
  const [glbHash, setGlbHash] = useState<string | null>(null)
  const [glbName, setGlbName] = useState<string | null>(null)
  const [regTags, setRegTags] = useState("")
  const [regName, setRegName] = useState("")
  const [regNote, setRegNote] = useState("")
  const [saved, setSaved] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const CATS = ["", ...new Set(FURNI.map((f) => f.category))]
  const [cat, setCat] = useState("")
  const [tagFilter, setTagFilter] = useState("")
  const ALL_TAGS = useMemo(() => [...new Set(FURNI.flatMap((f) => f.tags))].sort(), [])

  const def = FURNI[idx]

  const filtered = filter || tagFilter
    ? FURNI.filter((f) => {
        if (filter && !f.name.includes(filter) && !f.tags.some((t) => t.includes(filter))) return false
        if (tagFilter && !f.tags.includes(tagFilter)) return false
        return true
      })
    : FURNI

  const [allModels, setAllModels] = useState<DiscoveredModel[]>([])
  const [registeredNames, setRegisteredNames] = useState<Set<string>>(new Set())
  const [allEntries, setAllEntries] = useState<Record<string, FurnitureEntry>>({})
  const [modelsFilter, setModelsFilter] = useState("")
  const [sectionTab, setSectionTab] = useState<"uncalibrated" | "registered">("uncalibrated")

  // Load discovered models + registry
  const refreshModels = useCallback(async () => {
    clearModelCache()
    setAllModels(await discoverModels())
    const entries = await getAllEntries()
    setAllEntries(Object.fromEntries(entries.map((e) => [e.id, e])))
    setRegisteredNames(new Set(entries.filter((e) => e.glb).map((e) => e.id)))
  }, [])

  useEffect(() => { refreshModels() }, [refreshModels])

  const filteredModels = useMemo(() => {
    let list = allModels.filter((m) => !registeredNames.has(m.filename))
    if (modelsFilter) {
      const q = modelsFilter.toLowerCase()
      list = list.filter((m) => m.filename.toLowerCase().includes(q))
    }
    return list
  }, [allModels, registeredNames, modelsFilter])

  const handleModelClick = useCallback(async (model: DiscoveredModel) => {
    if (glbUrl) URL.revokeObjectURL(glbUrl)
    setIdx(0) // deselect primitive
    try {
      const res = await fetch(model.url)
      if (!res.ok) return
      const blob = await res.blob()
      const buf = await blob.arrayBuffer()
      const hashBytes = await crypto.subtle.digest("SHA-256", buf)
      const hash = "sha256:" + Array.from(new Uint8Array(hashBytes)).map((b) => b.toString(16).padStart(2, "0")).join("")
      const url = URL.createObjectURL(blob)
      setGlbUrl(url)
      setGlbHash(hash)
      setGlbName(model.filename)
      // Look up by filename for calibration
      const entry = await getEntry(model.filename)
      setTx(entry?.calibration?.tx ?? 0)
      setTy(entry?.calibration?.ty ?? 0)
      setTz(entry?.calibration?.tz ?? 0)
      setRot(entry?.calibration?.rot ?? 0)
      setSc(entry?.calibration?.scale ?? 1)
    } catch {
      // Fallback: direct URL without hash
      setGlbUrl(model.url)
      setGlbHash(null)
      setGlbName(model.filename)
    }
  }, [glbUrl])

  return (
    <div style={{ display: "flex", height: "100%", fontFamily: "system-ui", background: pal.bg }}>
      {/* ── LEFT: Picker ── */}
      <div style={{ width: 220, background: pal.panel, borderRight: `1px solid ${pal.border}`, display: "flex", flexDirection: "column", overflow: "hidden", flexShrink: 0 }}>
        {/* Search + category chips */}
        <div style={{ padding: "6px 7px", borderBottom: `1px solid ${pal.border}` }}>
          <input value={filter} onChange={(e) => { setFilter(e.target.value); setModelsFilter(e.target.value) }}
            placeholder="Search…"
            style={{ width: "100%", padding: "3px 6px", background: pal.bg, border: `1px solid ${pal.border}`, borderRadius: 4, color: pal.text, fontSize: 10, outline: "none" }}
          />
          <div style={{ display: "flex", gap: 2, marginTop: 4, flexWrap: "wrap" }}>
            {CATS.map((c) => (
              <button key={c} onClick={() => setCat(c)}
                style={{
                  padding: "1px 5px", borderRadius: 3, border: `1px solid ${cat === c ? pal.accent : "transparent"}`,
                  background: cat === c ? `${pal.accent}22` : "transparent",
                  color: cat === c ? pal.accent : pal.dim, cursor: "pointer", fontSize: 8, lineHeight: "14px",
                }}>
                {c || "All"}
              </button>
            ))}
          </div>
        </div>
        {/* ── Two equal halves: primitives + uncalibrated ── */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          {/* Top half — primitive thumbnails */}
          <div style={{ flex: 1, overflow: "auto", padding: "5px 7px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 5, alignContent: "start" }}>
            {(cat ? filtered.filter((f) => f.category === cat) : filtered).map((f, i) => {
              const fi = FURNI.indexOf(f)
              const active = fi === idx
              return (
                <button key={f.id} onClick={() => { setIdx(fi); setTx(0); setTy(0); setTz(0); setRot(0); setSc(1); if (glbUrl) URL.revokeObjectURL(glbUrl); setGlbUrl(null); setGlbHash(null); setGlbName(null) }}
                  style={{
                    display: "flex", flexDirection: "column", alignItems: "center", gap: 3,
                    padding: "8px 4px", borderRadius: 6, border: `1px solid ${active ? pal.accent : "transparent"}`,
                    background: active ? `${pal.accent}12` : "transparent", cursor: "pointer",
                  }}>
                  <div style={{ width: 44, height: 44, borderRadius: 5, background: f.thumb, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, opacity: 0.7 }}>
                    {f.id === "bed" ? "🛏" : f.id === "patient" ? "🧑" : f.id === "iv" ? "💉" : f.id === "monitor" ? "🖥" : f.id === "chair" ? "🪑" : f.id === "plant" ? "🌿" : f.id === "cabinet" ? "🗄" : f.id === "bedside" ? "🪑" : "▣"}
                  </div>
                  <span style={{ fontSize: 10, color: active ? pal.accent : pal.text }}>{f.name}</span>
                </button>
              )
            })}
          </div>

          {/* Bottom half — model/registry tabs */}
          <div style={{ flex: 1, overflow: "auto", borderTop: `1px solid ${pal.border}`, padding: "5px 7px", display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", gap: 2, marginBottom: 4, flexShrink: 0 }}>
              <button onClick={() => setSectionTab("uncalibrated")}
                style={{ padding: "1px 6px", borderRadius: 3, border: "none", cursor: "pointer", fontSize: 8, fontWeight: sectionTab === "uncalibrated" ? 600 : 400, fontFamily: "system-ui", background: sectionTab === "uncalibrated" ? `${pal.accent}22` : "transparent", color: sectionTab === "uncalibrated" ? pal.accent : pal.dim }}>
                Uncalibrated
              </button>
              <button onClick={() => setSectionTab("registered")}
                style={{ padding: "1px 6px", borderRadius: 3, border: "none", cursor: "pointer", fontSize: 8, fontWeight: sectionTab === "registered" ? 600 : 400, fontFamily: "system-ui", background: sectionTab === "registered" ? `${pal.accent}22` : "transparent", color: sectionTab === "registered" ? pal.accent : pal.dim }}>
                Registered ({Object.keys(allEntries).length})
              </button>
              <button onClick={refreshModels} title="Rescan"
                style={{ marginLeft: "auto", padding: "1px 5px", background: "none", border: `1px solid ${pal.border}`, borderRadius: 3, color: pal.dim, cursor: "pointer", fontSize: 8, lineHeight: "14px" }}>
                ↻
              </button>
            </div>

            {sectionTab === "uncalibrated" ? (
              filteredModels.length === 0 ? (
                <div style={{ fontSize: 9, color: pal.dim, textAlign: "center", padding: "8px 0" }}>No .glb files found</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  {filteredModels.map((model) => {
                    const active = glbName === model.filename
                    return (
                      <button key={model.url} onClick={() => handleModelClick(model)}
                        style={{
                          display: "flex", alignItems: "center", gap: 5, padding: "4px 6px", borderRadius: 4,
                          border: `1px solid ${active ? pal.accent : "transparent"}`,
                          background: active ? `${pal.accent}12` : "transparent",
                          cursor: "pointer", textAlign: "left", fontSize: 9, color: active ? pal.accent : pal.text,
                        }}>
                        <span style={{ fontSize: 12 }}>📦</span>
                        <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{model.filename}</span>
                        <span style={{ color: pal.dim, fontSize: 8 }}>{model.rel.split("/")[0]}</span>
                      </button>
                    )
                  })}
                </div>
              )
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                {Object.entries(allEntries).length === 0 ? (
                  <div style={{ fontSize: 9, color: pal.dim, textAlign: "center", padding: "8px 0" }}>No registered items</div>
                ) : (
                  Object.entries(allEntries).map(([id, entry]) => (
                    <div key={id}
                      style={{ display: "flex", alignItems: "center", gap: 4, padding: "3px 6px", borderRadius: 4, border: `1px solid ${glbName === id ? pal.accent : "transparent"}`, background: glbName === id ? `${pal.accent}12` : "transparent", fontSize: 8, cursor: "pointer" }}
                      onClick={async () => {
                        if (entry.glb) {
                          try {
                            setIdx(0)
                            const res = await fetch(entry.glb)
                            if (!res.ok) return
                            const blob = await res.blob()
                            const buf = await blob.arrayBuffer()
                            const hashBytes = await crypto.subtle.digest("SHA-256", buf)
                            const hash = "sha256:" + Array.from(new Uint8Array(hashBytes)).map((b) => b.toString(16).padStart(2, "0")).join("")
                            setGlbUrl(URL.createObjectURL(blob))
                            setGlbHash(hash)
                            setGlbName(entry.id)
                            setTx(entry.calibration.tx); setTy(entry.calibration.ty); setTz(entry.calibration.tz)
                            setRot(entry.calibration.rot); setSc(entry.calibration.scale)
                            setRegName(entry.name)
                            setRegTags(entry.tags.join(", "))
                            setRegNote(entry.note ?? "")
                          } catch {}
                        }
                      }}>
                      <span style={{ fontSize: 11, opacity: entry.enabled ? 1 : 0.3 }}>📦</span>
                      <div style={{ flex: 1, overflow: "hidden" }}>
                        <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: entry.enabled ? pal.text : pal.dim }}>{entry.name || id}</div>
                        {entry.note && <div style={{ color: pal.dim, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 7 }}>{entry.note}</div>}
                      </div>
                      <button onClick={async (e) => { e.stopPropagation(); await toggleEnabled(id); refreshModels() }}
                        style={{ padding: "1px 4px", background: "none", border: `1px solid ${pal.border}`, borderRadius: 2, color: pal.dim, cursor: "pointer", fontSize: 7, lineHeight: "12px" }}>
                        {entry.enabled ? "on" : "off"}
                      </button>
                      <button onClick={async (e) => { e.stopPropagation(); if (confirm(`Remove "${entry.name || id}" from registry?`)) { await deleteEntry(id); refreshModels() } }}
                        style={{ padding: "1px 4px", background: "none", border: "none", color: "#e74c3c", cursor: "pointer", fontSize: 8, lineHeight: "12px", opacity: 0.5 }}>
                        ✕
                      </button>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
      </div>
      </div>

      {/* ── RIGHT: Preview + params ── */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {/* Info bar — compact */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 10px", borderBottom: `1px solid ${pal.border}`, background: pal.panel, fontSize: 10 }}>
          <span style={{ color: pal.accent, fontWeight: 700 }}>{glbName ?? def.name}</span>
          <span style={{ color: pal.dim }}>{glbUrl ? "GLB" : def.id}</span>
          {glbHash && <span style={{ color: pal.dim, fontSize: 8, fontFamily: "monospace", maxWidth: 60, overflow: "hidden", textOverflow: "ellipsis" }} title={glbHash}>{glbHash.slice(0, 12)}…</span>}
          <span style={{ color: pal.dim, marginLeft: "auto" }}>
            {glbUrl ? `loaded · ${glbName}` : `${def.category}`}
          </span>
          {glbUrl && <button onClick={() => { if (glbUrl) URL.revokeObjectURL(glbUrl); setGlbUrl(null); setGlbHash(null); setGlbName(null) }}
            style={{ padding: "1px 5px", background: "transparent", border: `1px solid ${pal.border}`, borderRadius: 3, color: pal.dim, cursor: "pointer", fontSize: 9 }}>
            ✕
          </button>}
        </div>

        {/* 3D preview — fills available space */}
        <div style={{ flex: 1, minHeight: 150, position: "relative" }}>
          <Canvas camera={{ position: [2.5, 2, 3], fov: 35 }} shadows style={{ background: pal.canvas }}>
            <ambientLight intensity={0.5} />
            <directionalLight position={[3,5,3]} intensity={0.7} castShadow shadow-mapSize-width={1024} shadow-mapSize-height={1024} />
            <directionalLight position={[-2,2,1]} intensity={0.3} />
            <hemisphereLight args={["#e8d8c8","#c8d8e0",0.3]} />
            <Preview def={def} tx={tx} ty={ty} tz={tz} rot={rot * Math.PI / 180} sc={sc} glbUrl={glbUrl ?? undefined} dark={dark} />
            <OrbitControls enableZoom enablePan enableRotate minDistance={1} maxDistance={8} target={[0, 0.2, 0]} />
          </Canvas>
          <div style={{ position: "absolute", bottom: 4, right: 6, fontSize: 8, color: pal.watermark, pointerEvents: "none" }}>
            grid: 1m · origin ●
          </div>
        </div>

        {/* ── Parameter panel ── */}
        <div style={{ padding: "5px 10px", borderTop: `1px solid ${pal.border}`, background: pal.panel, display: "flex", flexDirection: "column", gap: 4 }}>
          {/* Row 1 — sliders + JSON */}
          <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
            <div style={{ minWidth: 120, flex: 1 }}>
              <div style={{ fontSize: 8, color: pal.dim, fontWeight: 600, marginBottom: 2 }}>TRANSLATE</div>
              <SliderInput dark={dark} label="X" value={tx} min={-1.5} max={1.5} step={0.05} onChange={setTx} />
              <SliderInput dark={dark} label="Y" value={ty} min={-0.5} max={2} step={0.05} onChange={setTy} />
              <SliderInput dark={dark} label="Z" value={tz} min={-1.5} max={1.5} step={0.05} onChange={setTz} />
            </div>
            <div style={{ minWidth: 110, flex: 1 }}>
              <div style={{ fontSize: 8, color: pal.dim, fontWeight: 600, marginBottom: 2 }}>ROTATE</div>
              <SliderInput dark={dark} label="Y°" value={rot} min={0} max={360} step={1} onChange={setRot} />
              <div style={{ fontSize: 8, color: pal.dim, fontWeight: 600, marginBottom: 2, marginTop: 3 }}>SCALE</div>
              <SliderInput dark={dark} label="×" value={sc} min={0.01} max={100} step={0} onChange={setSc} log />
            </div>
            <div style={{ minWidth: 120, flex: 1, maxWidth: 200 }}>
              <TransformJSON dark={dark} id={def.id} name={glbName ?? def.name} tx={tx} ty={ty} tz={tz} rot={rot} scale={sc} glbName={glbName} glbHash={glbHash} onApply={({tx:a,ty:b,tz:c,rot:d,scale:e}) => { setTx(a); setTy(b); setTz(c); setRot(d); setSc(e) }} />
            </div>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 3, paddingBottom: 1, flexShrink: 0 }}>
              <button onClick={() => { setTx(0); setTy(0); setTz(0); setRot(0); setSc(1) }}
                style={{ padding: "3px 10px", background: pal.bg, border: `1px solid ${pal.border}`, borderRadius: 3, color: pal.text, cursor: "pointer", fontSize: 9 }}>
                Reset
              </button>
            </div>
          </div>

          {/* Row 2 — register form (only when GLB loaded) */}
          {glbHash && <div style={{ borderTop: `1px solid ${pal.border}`, paddingTop: 4, display: "flex", gap: 6, alignItems: "flex-start" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 2, flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 8, color: pal.dim, fontWeight: 600 }}>REGISTER</div>
              <input value={regName} onChange={(e) => setRegName(e.target.value)}
                placeholder="Furniture name" maxLength={40}
                style={{ width: "100%", padding: "2px 5px", background: pal.bg, border: `1px solid ${pal.border}`, borderRadius: 3, color: pal.text, fontSize: 8, outline: "none" }}
              />
              <div style={{ display: "flex", gap: 2 }}>
                <input value={regTags} onChange={(e) => setRegTags(e.target.value)}
                  placeholder="tag1, tag2…" style={{ flex: 1, padding: "2px 5px", background: pal.bg, border: `1px solid ${pal.border}`, borderRadius: 3, color: pal.text, fontSize: 8, outline: "none" }}
                />
                <button onClick={async () => {
                  const { buildEntry, mergeEntry, sanitizeTags } = await import("../data/furniture-registry")
                  const tags = sanitizeTags(regTags.split(",").map((t) => t.trim()).filter(Boolean))
                  const cat = tags[0] || "uncategorized"
                  const name = regName.trim() || (glbName ?? "model.glb")
                  const entry = buildEntry(glbName ?? "model.glb", name, cat, tags, glbHash, { scale: sc, tx, ty, tz, rot }, regNote.trim() || undefined)
                  await mergeEntry(entry)
                  setRegisteredNames((prev) => new Set(prev).add(glbName ?? ""))
                  setAllEntries((prev) => ({ ...prev, [entry.id]: entry }))
                  setSaved(true)
                  setTimeout(() => setSaved(false), 1200)
                }}
                  style={{ padding: "3px 10px", background: saved ? `${pal.accent}44` : `${pal.accent}22`, border: `1px solid ${pal.accent}`, borderRadius: 3, color: saved ? "#fff" : pal.accent, cursor: "pointer", fontSize: 9, whiteSpace: "nowrap", transition: "all 0.15s" }}>
                  {saved ? "✓" : "Save"}
                </button>
              </div>
              <textarea value={regNote} onChange={(e) => setRegNote(e.target.value)}
                placeholder="Notes…" rows={1} maxLength={200}
                style={{ width: "100%", padding: "2px 5px", background: pal.bg, border: `1px solid ${pal.border}`, borderRadius: 3, color: pal.text, fontSize: 8, outline: "none", resize: "none", fontFamily: "inherit" }}
              />
            </div>
            <div style={{ fontSize: 7, color: pal.dim, alignSelf: "flex-end", paddingBottom: 2, whiteSpace: "nowrap" }}>→ registry in git</div>
          </div>}
        </div>
          </div>
          {/* Tag chips */}
          {tagFilter && (
            <div style={{ display: "flex", gap: 2, marginTop: 3, flexWrap: "wrap" }}>
              {ALL_TAGS.map((t) => (
                <button key={t} onClick={() => setTagFilter(tagFilter === t ? "" : t)}
                  style={{
                    padding: "1px 5px", borderRadius: 3,
                    border: `1px solid ${tagFilter === t ? pal.accent : "transparent"}`,
                    background: tagFilter === t ? `${pal.accent}22` : "transparent",
                    color: tagFilter === t ? pal.accent : pal.dim,
                    cursor: "pointer", fontSize: 7, lineHeight: "14px",
                  }}>
                  #{t}
                </button>
              ))}
            </div>
          )}
        </div>
  )
}
