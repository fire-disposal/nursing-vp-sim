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
import { buildEntry, mergeEntry } from "../data/furniture-registry"

// ── Colour palette (light/dark aware) ──
function palette(dark: boolean) {
  return dark
    ? { bg: "#1a1a2a", panel: "#12121e", border: "#2a2a35", text: "#ccc", dim: "#666", accent: "#4fc3f7", canvas: "#1e1e28", watermark: "#fff2" }
    : { bg: "#e8e8ee", panel: "#fff", border: "#ddd", text: "#222", dim: "#888", accent: "#0288d1", canvas: "#ede8e2", watermark: "#0003" }
}

// ── Slider + number input ──
function SliderInput({ label, value, min, max, step, onChange, dark }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; dark: boolean }) {
  const pal = palette(dark)
  const [edit, setEdit] = useState<string | null>(null)

  const display = edit ?? ""
  const numValue = edit !== null ? Number(edit) : value
  const clamped = Math.min(max, Math.max(min, numValue))

  const commit = (v: string) => {
    const n = Number(v)
    if (!isNaN(n) && isFinite(n)) {
      onChange(Math.min(max, Math.max(min, Math.round(n / step) * step)))
    }
    setEdit(null)
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3, height: 22 }}>
      <span style={{ fontSize: 9, color: pal.dim, width: 20, flexShrink: 0 }}>{label}</span>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ flex: 1, height: 3, accentColor: pal.accent, cursor: "pointer" }} />
      <input type="text" value={display} placeholder={value.toFixed(step < 0.1 ? 2 : 1)}
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
      <gridHelper args={[3, 6, "#ccc", "#e0e0e0"]} position={[0, 0.002, 0]} />

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
  const fileRef = useRef<HTMLInputElement>(null)

  const filtered = filter
    ? FURNI.filter((f) => f.name.includes(filter) || f.tags.some((t) => t.includes(filter)))
    : FURNI
  const def = FURNI[idx]

  const CATS = ["", ...new Set(FURNI.map((f) => f.category))]
  const [cat, setCat] = useState("")

  const handleLoadGLB = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (glbUrl) URL.revokeObjectURL(glbUrl)
    const hash = await fileToHash(file)
    const url = URL.createObjectURL(file)
    setGlbUrl(url)
    setGlbHash(hash)
    setGlbName(file.name)
    // Look up by filename (stable key) — apply calibration if found
    const entry = await (await import("../data/furniture-registry")).getEntry(file.name)
    setTx(entry?.calibration?.tx ?? 0)
    setTy(entry?.calibration?.ty ?? 0)
    setTz(entry?.calibration?.tz ?? 0)
    setRot(entry?.calibration?.rot ?? 0)
    setSc(entry?.calibration?.scale ?? 1)
    e.target.value = ""
  }, [glbUrl])

  return (
    <div style={{ display: "flex", height: "100%", fontFamily: "system-ui", background: pal.bg }}>
      {/* ── LEFT: Picker ── */}
      <div style={{ width: 220, background: pal.panel, borderRight: `1px solid ${pal.border}`, display: "flex", flexDirection: "column", overflow: "hidden", flexShrink: 0 }}>
        {/* Search + category chips */}
        <div style={{ padding: "6px 7px", borderBottom: `1px solid ${pal.border}` }}>
          <input value={filter} onChange={(e) => setFilter(e.target.value)}
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
        {/* Thumbnail grid */}
        <div style={{ flex: 1, overflow: "auto", padding: "5px 7px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 5, alignContent: "start" }}>
          {(cat ? filtered.filter((f) => f.category === cat) : filtered).map((f, i) => {
            const fi = FURNI.indexOf(f)
            const active = fi === idx
            return (
              <button key={f.id} onClick={() => { setIdx(fi); setTx(0); setTy(0); setTz(0); setRot(0); setSc(1) }}
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
          <input ref={fileRef} type="file" accept=".glb" onChange={handleLoadGLB} style={{ display: "none" }} />
          <button onClick={() => fileRef.current?.click()}
            style={{ padding: "1px 8px", background: `${pal.accent}22`, border: `1px solid ${pal.accent}`, borderRadius: 3, color: pal.accent, cursor: "pointer", fontSize: 9 }}>
            +GLB
          </button>
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
            grid: 0.5m · origin ●
          </div>
        </div>

        {/* Parameter panel — compact bottom strip */}
        <div style={{ padding: "5px 10px", borderTop: `1px solid ${pal.border}`, background: pal.panel, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-start" }}>
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
            <SliderInput dark={dark} label="×" value={sc} min={0.1} max={3} step={0.05} onChange={setSc} />
          </div>

          <TransformJSON dark={dark} id={def.id} name={glbName ?? def.name} tx={tx} ty={ty} tz={tz} rot={rot} scale={sc} glbName={glbName} glbHash={glbHash} onApply={({tx:a,ty:b,tz:c,rot:d,scale:e}) => { setTx(a); setTy(b); setTz(c); setRot(d); setSc(e) }} />

          {glbHash && <button onClick={async () => {
            const { buildEntry, mergeEntry } = await import("../data/furniture-registry")
            const entry = buildEntry(
              glbName ?? "model.glb",
              glbName ?? "model.glb",
              "uncategorized",
              [],
              glbHash,
              { scale: sc, tx, ty, tz, rot },
            )
            const json = await mergeEntry(entry)
            const blob = new Blob([json], { type: "application/json" })
            const a = document.createElement("a")
            a.href = URL.createObjectURL(blob)
            a.download = "furniture-registry.json"
            a.click()
            URL.revokeObjectURL(a.href)
          }}
            style={{ padding: "3px 8px", background: `${pal.accent}22`, border: `1px solid ${pal.accent}`, borderRadius: 3, color: pal.accent, cursor: "pointer", fontSize: 9, alignSelf: "flex-end", marginBottom: 1 }}>
            Save Reg
          </button>}

          <div style={{ display: "flex", alignItems: "flex-end", gap: 3, paddingBottom: 1 }}>
            <button onClick={() => { setTx(0); setTy(0); setTz(0); setRot(0); setSc(1) }}
              style={{ padding: "3px 10px", background: pal.bg, border: `1px solid ${pal.border}`, borderRadius: 3, color: pal.text, cursor: "pointer", fontSize: 9 }}>
              Reset
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
