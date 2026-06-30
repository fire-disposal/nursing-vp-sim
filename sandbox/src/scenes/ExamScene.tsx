import { useCallback, useRef, useState } from "react"
import { emitSceneEvent, type SceneProps, type SceneState } from "../scene-types"

// ── Operation definition ──
interface OpDef {
  id: string
  label: string
  unit: string
  category: "vital" | "auscultation" | "neuro" | "musculoskeletal" | "bedside"
}

interface BodyPart {
  id: string; label: string
  x: number; y: number; w: number; h: number
  ops: OpDef[]
}

const ALL_OPS: Record<string, OpDef> = {
  // Vital signs
  temp:  { id: "temp",  label: "体温",     unit: "°C",     category: "vital" },
  hr:    { id: "hr",    label: "心率",     unit: "次/分",   category: "vital" },
  rr:    { id: "rr",    label: "呼吸频率",  unit: "次/分",   category: "vital" },
  bp:    { id: "bp",    label: "血压",     unit: "mmHg",    category: "vital" },
  spo2:  { id: "spo2",  label: "血氧饱和度", unit: "%",     category: "vital" },
  pain:  { id: "pain",  label: "疼痛评分",  unit: "/10",    category: "vital" },

  // Auscultation
  lung:  { id: "lung",  label: "肺部听诊",  unit: "",       category: "auscultation" },
  heart: { id: "heart", label: "心脏听诊",  unit: "",       category: "auscultation" },
  bowel: { id: "bowel", label: "肠鸣音",    unit: "次/分",   category: "auscultation" },

  // Neuro
  pupil: { id: "pupil", label: "瞳孔检查",  unit: "",       category: "neuro" },
  gcs:   { id: "gcs",   label: "GCS 评分",  unit: "/15",    category: "neuro" },

  // Musculoskeletal
  strength: { id: "strength", label: "肌力",    unit: "/5",  category: "musculoskeletal" },
  edema:    { id: "edema",    label: "水肿评估", unit: "",   category: "musculoskeletal" },

  // Bedside
  glucose: { id: "glucose", label: "血糖",  unit: "mmol/L", category: "bedside" },
  ecg:     { id: "ecg",     label: "心电图", unit: "",      category: "bedside" },
}

const BODY_PARTS: BodyPart[] = [
  {
    id: "head", label: "头部", x: 38, y: 2, w: 24, h: 18,
    ops: [ALL_OPS.temp, ALL_OPS.pain, ALL_OPS.pupil, ALL_OPS.gcs],
  },
  {
    id: "chest", label: "胸部", x: 30, y: 24, w: 40, h: 26,
    ops: [ALL_OPS.hr, ALL_OPS.rr, ALL_OPS.spo2, ALL_OPS.heart, ALL_OPS.lung, ALL_OPS.ecg],
  },
  {
    id: "arm_l", label: "左上肢", x: 8, y: 26, w: 18, h: 36,
    ops: [ALL_OPS.bp, ALL_OPS.glucose, ALL_OPS.strength],
  },
  {
    id: "arm_r", label: "右上肢", x: 74, y: 26, w: 18, h: 36,
    ops: [ALL_OPS.bp, ALL_OPS.glucose, ALL_OPS.strength],
  },
  {
    id: "abdomen", label: "腹部", x: 34, y: 52, w: 32, h: 18,
    ops: [ALL_OPS.bowel, ALL_OPS.pain],
  },
  {
    id: "leg_l", label: "左下肢", x: 22, y: 72, w: 22, h: 26,
    ops: [ALL_OPS.strength, ALL_OPS.edema],
  },
  {
    id: "leg_r", label: "右下肢", x: 56, y: 72, w: 22, h: 26,
    ops: [ALL_OPS.strength, ALL_OPS.edema],
  },
]

// ── Clinical result generators ──
type SimFn = () => { value: string; details?: string }

const SIMULATORS: Record<string, SimFn> = {
  temp:    () => ({ value: (36.2 + Math.random() * 1.8).toFixed(1) }),
  hr:      () => ({ value: String(Math.floor(72 + Math.random() * 40)) }),
  rr:      () => ({ value: String(Math.floor(14 + Math.random() * 12)) }),
  bp:      () => ({ value: `${Math.floor(110 + Math.random() * 25)}/${Math.floor(70 + Math.random() * 20)}` }),
  spo2:    () => ({ value: String(Math.floor(94 + Math.random() * 6)) }),
  pain:    () => ({ value: String(Math.floor(Math.random() * 5)) }),

  lung:    () => {
    const f = ["双肺呼吸音清，未闻及干湿啰音", "右下肺可闻及湿啰音", "双肺散在哮鸣音", "呼吸音粗，可闻及痰鸣音"]
    return { value: f[Math.floor(Math.random() * f.length)] }
  },
  heart:   () => {
    const f = ["心律齐，各瓣膜听诊区未闻及病理性杂音", "心律齐，可闻及 II/6 级收缩期杂音", "心律绝对不齐，脉搏短绌"]
    return { value: f[Math.floor(Math.random() * f.length)] }
  },
  bowel:   () => {
    const n = Math.floor(4 + Math.random() * 8)
    return { value: `${n}`, details: n < 4 ? "肠鸣音减弱" : n > 10 ? "肠鸣音活跃" : "肠鸣音正常" }
  },

  pupil:   () => {
    const sides = ["双侧瞳孔等大等圆", "左侧瞳孔散大", "右侧瞳孔缩小"]
    const react = ["对光反射灵敏", "对光反射迟钝", "对光反射消失"]
    return { value: `${sides[Math.floor(Math.random() * sides.length)]}，${react[Math.floor(Math.random() * react.length)]}` }
  },
  gcs:     () => {
    const e = Math.floor(3 + Math.random() * 2) // 3-4
    const v = Math.floor(4 + Math.random() * 2) // 4-5
    const m = Math.floor(5 + Math.random() * 2) // 5-6
    return { value: `${e + v + m} (E${e}V${v}M${m})` }
  },

  strength: () => {
    const scores = [5, 5, 5, 4, 4, 3]
    const s = scores[Math.floor(Math.random() * scores.length)]
    return { value: `${s}`, details: s >= 5 ? "肌力正常" : s >= 4 ? "轻度减弱" : "中度减弱" }
  },
  edema:   () => {
    const levels = ["无凹陷性水肿", "轻度凹陷性水肿 (1+)", "中度凹陷性水肿 (2+)", "重度凹陷性水肿 (3+)"]
    return { value: levels[Math.floor(Math.random() * levels.length)] }
  },

  glucose: () => ({ value: (4.0 + Math.random() * 6.0).toFixed(1) }),
  ecg:     () => {
    const f = ["窦性心律，未见明显异常", "窦性心动过速", "窦性心动过缓", "房性早搏", "ST-T 改变"]
    return { value: f[Math.floor(Math.random() * f.length)] }
  },
}

function getCategoryColor(cat: string): string {
  switch (cat) {
    case "vital":           return "#4fc3f7"
    case "auscultation":    return "#7c4dff"
    case "neuro":           return "#ff7043"
    case "musculoskeletal": return "#66bb6a"
    case "bedside":         return "#ffa726"
    default:                return "#888"
  }
}

function getCategoryLabel(cat: string): string {
  switch (cat) {
    case "vital":           return "生命体征"
    case "auscultation":    return "听诊"
    case "neuro":           return "神经系统"
    case "musculoskeletal": return "骨骼肌肉"
    case "bedside":         return "床旁检测"
    default:                return ""
  }
}

// ── ExamScene ──
export default function ExamScene({ bus, mode }: SceneProps) {
  const [results, setResults] = useState<Record<string, { op: OpDef; value: string; details?: string }>>({})
  const [selected, setSelected] = useState<BodyPart | null>(null)
  const [activeOp, setActiveOp] = useState<string | null>(null)
  const logRef = useRef<HTMLDivElement>(null)

  const performOp = useCallback((part: BodyPart, op: OpDef) => {
    setActiveOp(op.id)
    const sim = SIMULATORS[op.id]
    const { value, details } = sim ? sim() : { value: "—" }
    setResults((prev) => ({ ...prev, [part.id + ":" + op.id]: { op, value, details } }))

    emitSceneEvent(bus, "scene:interaction", {
      hotspotId: part.id,
      metadata: { op_type: op.id, body_part: part.id, value },
    })

    // Broadcast SceneState update
    const patch: Partial<SceneState> = {}
    if (op.id === "hr")   patch.vitals = { hr: Number(value) }
    if (op.id === "bp")   { const [s, d] = value.split("/"); patch.vitals = { bp_sys: Number(s), bp_dia: Number(d) } }
    if (op.id === "rr")   patch.vitals = { rr: Number(value) }
    if (op.id === "spo2") patch.vitals = { spo2: Number(value) }
    if (op.id === "temp") patch.vitals = { temp: Number(value) }
    if (op.id === "pain") patch.vitals = { pain: Number(value) }
    if (op.id === "glucose") patch.vitals = { ...patch.vitals }
    if (Object.keys(patch).length) emitSceneEvent(bus, "scene:state", patch)

    setSelected(null)
    setTimeout(() => setActiveOp(null), 400)
    if (logRef.current) logRef.current.scrollTop = 0
  }, [bus])

  const groupedOps = useCallback((ops: OpDef[]) => {
    const groups: Record<string, OpDef[]> = {}
    for (const op of ops) {
      (groups[op.category] ??= []).push(op)
    }
    return Object.entries(groups)
  }, [])

  return (
    <div style={{ display: "flex", height: "100%", fontFamily: "system-ui", background: "#1a1a2a" }}>
      {/* Body diagram */}
      <div style={{ flex: 1, position: "relative", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
        <div style={{ position: "relative", width: "55%", maxWidth: 320, aspectRatio: "0.48", background: "#222", borderRadius: "60px 60px 30px 30px", border: "2px solid #3a3a4e" }}>
          {BODY_PARTS.map((part) => {
            const isSelected = selected?.id === part.id
            return (
              <div key={part.id}>
                <div onClick={() => setSelected(isSelected ? null : part)}
                  onMouseEnter={(e) => { if (!isSelected) { (e.currentTarget as HTMLDivElement).style.borderColor = "#555"; (e.currentTarget as HTMLDivElement).style.background = "#ffffff06" }}}
                  onMouseLeave={(e) => { if (!isSelected) { (e.currentTarget as HTMLDivElement).style.borderColor = "transparent"; (e.currentTarget as HTMLDivElement).style.background = "transparent" }}}
                  style={{
                    position: "absolute", left: `${part.x}%`, top: `${part.y}%`,
                    width: `${part.w}%`, height: `${part.h}%`,
                    border: isSelected ? "2px solid #4fc3f7" : "1px solid transparent",
                    borderRadius: 8, cursor: "pointer", transition: "all 0.15s",
                    background: isSelected ? "#4fc3f718" : "transparent",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    color: isSelected ? "#4fc3f7" : "#444", fontSize: 10, fontWeight: 500,
                  }}
                >
                  {part.label}
                </div>

                {/* Op popup */}
                {isSelected && (
                  <div style={{
                    position: "absolute", left: `${part.x + part.w / 2}%`, top: `${part.y}%`,
                    transform: "translate(-50%, -108%)", zIndex: 10,
                    background: "#1a1a2e", border: "1px solid #4fc3f7", borderRadius: 10,
                    padding: "8px 8px 4px", boxShadow: "0 4px 20px rgba(0,0,0,0.5)",
                    minWidth: 160, maxWidth: 220,
                  }}>
                    {groupedOps(part.ops).map(([cat, ops]) => (
                      <div key={cat} style={{ marginBottom: 6 }}>
                        <div style={{ fontSize: 9, color: "#666", marginBottom: 3, fontWeight: 600 }}>
                          {getCategoryLabel(cat)}
                        </div>
                        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                          {ops.map((op) => (
                            <button key={op.id} onClick={() => performOp(part, op)}
                              style={{
                                padding: "3px 8px", background: activeOp === op.id ? getCategoryColor(cat) : "#2a2a3e",
                                border: `1px solid ${getCategoryColor(cat)}44`, borderRadius: 4,
                                color: activeOp === op.id ? "#111" : "#ccc", cursor: "pointer",
                                fontSize: 10, whiteSpace: "nowrap", transition: "all 0.1s",
                              }}>
                              {op.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                    <div style={{ textAlign: "center", fontSize: 9, color: "#555", paddingTop: 4, borderTop: "1px solid #2a2a3e", marginTop: 4 }}>
                      点击选择检查项目
                    </div>
                  </div>
                )}
              </div>
            )
          })}
          <div style={{ position: "absolute", left: "44%", top: "6%", fontSize: 18, pointerEvents: "none", opacity: 0.15 }}>🙂</div>
        </div>
      </div>

      {/* Results panel */}
      <div style={{
        width: 280, background: "#12121e", borderLeft: "1px solid #333",
        display: "flex", flexDirection: "column", fontFamily: "monospace", fontSize: 11,
      }}>
        <div style={{ padding: "10px 14px", borderBottom: "1px solid #333", color: "#888", fontWeight: 700, fontSize: 12 }}>
          ◈ 检查记录
        </div>
        <div ref={logRef} style={{ flex: 1, overflow: "auto", padding: "4px 0" }}>
          {Object.keys(results).length === 0 && (
            <div style={{ padding: 20, color: "#444", textAlign: "center", fontSize: 11 }}>
              点击人体部位选择检查项目
            </div>
          )}
          {Object.entries(results).map(([key, r]) => (
            <div key={key} style={{ padding: "8px 14px", borderBottom: "1px solid #1a1a2a" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
                <span style={{
                  display: "inline-block", width: 6, height: 6, borderRadius: "50%",
                  background: getCategoryColor(r.op.category),
                }} />
                <span style={{ color: "#999", fontSize: 10 }}>{r.op.label}</span>
                <span style={{ color: "#555", fontSize: 9 }}>{r.op.unit}</span>
              </div>
              <div style={{ color: "#e0e0e0", fontWeight: 600, fontSize: 12, marginLeft: 12 }}>
                {r.value}
              </div>
              {r.details && (
                <div style={{ color: "#666", fontSize: 10, marginLeft: 12 }}>{r.details}</div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
