import { useCallback, useRef, useState } from "react"
import { emitSceneEvent, type SceneMeta, type SceneProps, type SceneState } from "../scene-types"

// ═══ 1. Normal values ═══
const NORMALS: Record<string, { label: string; unit: string; normal: string; cat: string }> = {
  temp:     { label: "体温",      unit: "°C",     normal: "36.8",                        cat: "vital" },
  hr:       { label: "心率",      unit: "次/分",   normal: "76",                          cat: "vital" },
  rr:       { label: "呼吸频率",   unit: "次/分",   normal: "18",                          cat: "vital" },
  bp:       { label: "血压",      unit: "mmHg",    normal: "120/80",                      cat: "vital" },
  spo2:     { label: "血氧饱和度", unit: "%",       normal: "98",                          cat: "vital" },
  pain:     { label: "疼痛评分",   unit: "/10",     normal: "0",                           cat: "vital" },
  lung:     { label: "肺部听诊",   unit: "",        normal: "双肺呼吸音清，未闻及干湿啰音", cat: "auscultation" },
  heart:    { label: "心脏听诊",   unit: "",        normal: "心律齐，各瓣膜听诊区未闻及病理性杂音", cat: "auscultation" },
  bowel:    { label: "肠鸣音",    unit: "次/分",    normal: "5",                           cat: "auscultation" },
  pupil:    { label: "瞳孔检查",   unit: "",        normal: "双侧瞳孔等大等圆，对光反射灵敏", cat: "neuro" },
  gcs:      { label: "GCS 评分",  unit: "/15",     normal: "15 (E4V5M6)",                 cat: "neuro" },
  strength: { label: "肌力",       unit: "/5",     normal: "5",                           cat: "musculoskeletal" },
  edema:    { label: "水肿评估",   unit: "",        normal: "无凹陷性水肿",                 cat: "musculoskeletal" },
  glucose:  { label: "血糖",      unit: "mmol/L",  normal: "5.2",                         cat: "bedside" },
  ecg:      { label: "心电图",    unit: "",         normal: "窦性心律，未见明显异常",        cat: "bedside" },
}

const CAT_COLOR: Record<string, string> = {
  vital: "#4fc3f7", auscultation: "#7c4dff", neuro: "#ff7043",
  musculoskeletal: "#66bb6a", bedside: "#ffa726",
}

// ═══ 2. Hardcoded randomizers ═══
type RandFn = (base: string) => string
const RANDOMIZERS: Record<string, RandFn> = {
  temp: (b) => { const n = Number(b) + (Math.random() - 0.5) * 0.4; return n.toFixed(1) },
  hr:   (b) => `${Math.round(Number(b) + (Math.random() - 0.5) * 8)}`,
  rr:   (b) => `${Math.round(Number(b) + (Math.random() - 0.5) * 4)}`,
  bp:   (b) => { const [s, d] = b.split("/").map(Number); return `${Math.round(s + (Math.random() - 0.5) * 10)}/${Math.round(d + (Math.random() - 0.5) * 8)}` },
  spo2: (b) => `${Math.round(Number(b) + (Math.random() - 0.5) * 2)}`,
}

function resolve(opId: string): { value: string; abnormal: boolean } {
  const def = NORMALS[opId]
  if (!def) return { value: "—", abnormal: false }
  const rand = RANDOMIZERS[opId]
  return { value: rand ? rand(def.normal) : def.normal, abnormal: false }
}

// ═══ 3. Body parts ═══
interface Part { id: string; label: string; x: number; y: number; w: number; h: number; ops: string[] }
const PARTS: Part[] = [
  { id: "head",    label: "头部",   x: 38, y: 2,  w: 24, h: 18, ops: ["temp","pain","pupil","gcs"] },
  { id: "chest",   label: "胸部",   x: 30, y: 24, w: 40, h: 26, ops: ["hr","rr","spo2","heart","lung","ecg"] },
  { id: "arm_l",   label: "左上肢", x: 8,  y: 26, w: 18, h: 36, ops: ["bp","glucose","strength"] },
  { id: "arm_r",   label: "右上肢", x: 74, y: 26, w: 18, h: 36, ops: ["bp","glucose","strength"] },
  { id: "abdomen", label: "腹部",   x: 34, y: 52, w: 32, h: 18, ops: ["bowel","pain"] },
  { id: "leg_l",   label: "左下肢", x: 22, y: 72, w: 22, h: 26, ops: ["strength","edema"] },
  { id: "leg_r",   label: "右下肢", x: 56, y: 72, w: 22, h: 26, ops: ["strength","edema"] },
]

function groupByCat(ops: string[]): [string, string[]][] {
  const m = new Map<string, string[]>()
  for (const id of ops) {
    const c = NORMALS[id]?.cat ?? "other"
    if (!m.has(c)) m.set(c, [])
    m.get(c)!.push(id)
  }
  return [...m.entries()]
}

// ═══ 4. Component ═══
export default function ExamScene({ bus }: SceneProps) {
  const [results, setResults] = useState<Record<string, { value: string; abnormal: boolean }>>({})
  const [selected, setSelected] = useState<string | null>(null)
  const [flash, setFlash] = useState<string | null>(null)
  const logRef = useRef<HTMLDivElement>(null)

  const interact = useCallback((opId: string) => {
    const def = NORMALS[opId]
    if (!def) return
    setFlash(opId)
    const { value, abnormal } = resolve(opId)
    setResults((prev) => ({ ...prev, [opId]: { value, abnormal } }))

    emitSceneEvent(bus, "scene:interaction", { hotspotId: selected ?? "", metadata: { op_type: opId, value } })

    const patch: Partial<SceneState> = {}
    if (opId === "hr")   patch.vitals = { hr: Number(value) }
    if (opId === "bp")   { const [s, d] = value.split("/"); patch.vitals = { bp_sys: Number(s), bp_dia: Number(d) } }
    if (opId === "rr")   patch.vitals = { rr: Number(value) }
    if (opId === "spo2") patch.vitals = { spo2: Number(value) }
    if (opId === "temp") patch.vitals = { temp: Number(value) }
    if (opId === "pain") patch.vitals = { pain: Number(value) }
    if (Object.keys(patch).length) emitSceneEvent(bus, "scene:state", patch)

    setSelected(null)
    setTimeout(() => setFlash(null), 350)
    logRef.current?.scrollTo(0, 0)
  }, [bus, selected])

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 420, fontFamily: "system-ui", background: "#1a1a2a" }}>
      <div style={{ flex: 1, position: "relative", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: 300 }}>
        <div style={{ position: "relative", width: "55%", maxWidth: 320, aspectRatio: "0.48", background: "#222", borderRadius: "60px 60px 30px 30px", border: "2px solid #3a3a4e" }}>
          {PARTS.map((part) => {
            const sel = selected === part.id
            return (
              <div key={part.id}>
                <div onClick={() => setSelected(sel ? null : part.id)}
                  onMouseEnter={(e) => { if (!sel) { (e.currentTarget as HTMLDivElement).style.borderColor = "#555"; (e.currentTarget as HTMLDivElement).style.background = "#ffffff06" } }}
                  onMouseLeave={(e) => { if (!sel) { (e.currentTarget as HTMLDivElement).style.borderColor = "transparent"; (e.currentTarget as HTMLDivElement).style.background = "transparent" } }}
                  style={{
                    position: "absolute", left: `${part.x}%`, top: `${part.y}%`,
                    width: `${part.w}%`, height: `${part.h}%`,
                    border: sel ? "2px solid #4fc3f7" : "1px solid transparent",
                    borderRadius: 8, cursor: "pointer", transition: "all 0.15s",
                    background: sel ? "#4fc3f718" : "transparent",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    color: sel ? "#4fc3f7" : "#444", fontSize: 10, fontWeight: 500,
                  }}>
                  {part.label}
                </div>

                {sel && (
                  <div style={{
                    position: "absolute", left: `${part.x + part.w / 2}%`, top: `${part.y + part.h / 2}%`,
                    transform: "translate(-50%, -50%)", zIndex: 10,
                    background: "#1a1a2e", border: "1px solid #4fc3f7", borderRadius: 10,
                    padding: "8px 8px 4px", boxShadow: "0 4px 20px rgba(0,0,0,0.5)", minWidth: 160,
                  }}>
                    {groupByCat(part.ops).map(([cat, ids]) => (
                      <div key={cat} style={{ marginBottom: 6 }}>
                        <div style={{ fontSize: 9, color: "#666", marginBottom: 3, fontWeight: 600 }}>{cat}</div>
                        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                          {ids.map((id) => {
                            const def = NORMALS[id]
                            if (!def) return null
                            return (
                              <button key={id} onClick={() => interact(id)}
                                style={{
                                  padding: "3px 8px",
                                  background: flash === id ? (CAT_COLOR[def.cat] ?? "#888") : "#2a2a3e",
                                  border: `1px solid ${CAT_COLOR[def.cat] ?? "#888"}44`,
                                  borderRadius: 4, cursor: "pointer", fontSize: 10, whiteSpace: "nowrap",
                                  color: flash === id ? "#111" : "#ccc",
                                  transition: "all 0.1s",
                                }}>
                                {def.label}
                              </button>
                            )
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Results footer strip */}
      <div style={{ height: 32, background: "#12121e", borderTop: "1px solid #333", display: "flex", alignItems: "center", gap: 4, padding: "0 8px", overflowX: "auto", fontSize: 10, fontFamily: "monospace" }}>
        {Object.keys(results).length === 0 ? (
          <span style={{ color: "#555", padding: "0 4px" }}>点击人体部位选择检查项目</span>
        ) : (
          Object.entries(results).map(([id, r]) => {
            const def = NORMALS[id]
            if (!def) return null
            return (
              <span key={id} style={{
                display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 6px", borderRadius: 4, whiteSpace: "nowrap",
                background: r.abnormal ? "#ff704322" : "#1a1a2e", color: r.abnormal ? "#ff7043" : "#aaa",
              }}>
                <span style={{ width: 5, height: 5, borderRadius: "50%", background: CAT_COLOR[def.cat] ?? "#888", flexShrink: 0 }} />
                {def.label} <span style={{ fontWeight: 600 }}>{r.value}</span>{def.unit}
              </span>
            )
          })
        )}
      </div>
    </div>
  )
}
export const sceneMeta: SceneMeta = {
  id: "demo-exam", name: "查体场景", description: "人体图查体交互", icon: "🩺",
  size: { minW: 360, minH: 400, w: 420, h: 480 },
}
