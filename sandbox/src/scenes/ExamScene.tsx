import { useCallback, useRef, useState } from "react"
import { emitSceneEvent, type SceneProps, type SceneState } from "../scene-types"

// ── Body region definitions ──
interface BodyPart {
  id: string
  label: string
  ops: { id: string; label: string; unit: string }[]
  // CSS position (percent) for the clickable hotspot
  x: number; y: number; w: number; h: number
}

const BODY_PARTS: BodyPart[] = [
  { id: "head", label: "头部", x: 38, y: 2, w: 24, h: 18, ops: [
    { id: "temp", label: "体温", unit: "°C" },
    { id: "pain", label: "疼痛评分", unit: "/10" },
  ]},
  { id: "chest", label: "胸部", x: 30, y: 24, w: 40, h: 26, ops: [
    { id: "hr", label: "心率", unit: "次/分" },
    { id: "rr", label: "呼吸频率", unit: "次/分" },
    { id: "spo2", label: "血氧饱和度", unit: "%" },
  ]},
  { id: "arm_l", label: "左上肢", x: 8, y: 26, w: 18, h: 36, ops: [
    { id: "bp", label: "血压", unit: "mmHg" },
    { id: "skin", label: "皮肤检查", unit: "" },
  ]},
  { id: "arm_r", label: "右上肢", x: 74, y: 26, w: 18, h: 36, ops: [
    { id: "bp", label: "血压", unit: "mmHg" },
    { id: "skin", label: "皮肤检查", unit: "" },
  ]},
  { id: "abdomen", label: "腹部", x: 34, y: 52, w: 32, h: 18, ops: [
    { id: "pain", label: "疼痛评分", unit: "/10" },
    { id: "skin", label: "皮肤检查", unit: "" },
  ]},
  { id: "leg_l", label: "左下肢", x: 22, y: 72, w: 22, h: 26, ops: [
    { id: "skin", label: "皮肤检查", unit: "" },
  ]},
  { id: "leg_r", label: "右下肢", x: 56, y: 72, w: 22, h: 26, ops: [
    { id: "skin", label: "皮肤检查", unit: "" },
  ]},
]

// ── ExamScene ──
export default function ExamScene({ bus, mode }: SceneProps) {
  const [results, setResults] = useState<Record<string, { label: string; value: string; unit: string }>>({})
  const [selected, setSelected] = useState<BodyPart | null>(null)
  const [activeOp, setActiveOp] = useState<string | null>(null)
  const logRef = useRef<HTMLDivElement>(null)

  const simulateResult = useCallback((opId: string): { label: string; value: string; unit: string } => {
    const SIMS: Record<string, () => string> = {
      temp: () => `${(36.2 + Math.random() * 1.5).toFixed(1)}`,
      hr:   () => `${Math.floor(72 + Math.random() * 30)}`,
      rr:   () => `${Math.floor(14 + Math.random() * 10)}`,
      bp:   () => `${Math.floor(110 + Math.random() * 20)}/${Math.floor(70 + Math.random() * 15)}`,
      spo2: () => `${Math.floor(95 + Math.random() * 4)}`,
      skin: () => "皮肤温暖干燥，未见明显异常",
      pain: () => `${Math.floor(Math.random() * 4)}`,
    }
    const gen = SIMS[opId]
    return { label: "", value: gen ? gen() : "—", unit: "" }
  }, [])

  const handlePartClick = useCallback((part: BodyPart) => {
    setSelected((prev) => prev?.id === part.id ? null : part)
  }, [])

  const performOp = useCallback((part: BodyPart, op: BodyPart["ops"][0]) => {
    setActiveOp(op.id)
    const result = simulateResult(op.id)
    setResults((prev) => ({ ...prev, [part.id + ":" + op.id]: { ...result, label: op.label, unit: op.unit } }))

    emitSceneEvent(bus, "scene:interaction", {
      hotspotId: part.id,
      metadata: { op_type: op.id, body_part: part.id, value: result.value },
    })

    // Simulate backend response — broadcast state update
    const vitalsPatch: Partial<SceneState> = {}
    if (op.id === "hr")  vitalsPatch.vitals = { hr: Number(result.value) }
    if (op.id === "bp")  vitalsPatch.vitals = { bp_sys: Number(result.value.split("/")[0]), bp_dia: Number(result.value.split("/")[1]) }
    if (op.id === "rr")  vitalsPatch.vitals = { rr: Number(result.value) }
    if (op.id === "spo2") vitalsPatch.vitals = { spo2: Number(result.value) }
    if (op.id === "temp") vitalsPatch.vitals = { temp: Number(result.value) }
    if (Object.keys(vitalsPatch).length) emitSceneEvent(bus, "scene:state", vitalsPatch)

    setSelected(null)
    setTimeout(() => setActiveOp(null), 400)

    if (logRef.current) logRef.current.scrollTop = 0
  }, [bus, simulateResult])

  return (
    <div style={{ display: "flex", height: "100%", fontFamily: "system-ui", background: "#222" }}>
      {/* Body diagram area */}
      <div style={{ flex: 1, position: "relative", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
        <div style={{ position: "relative", width: "60%", maxWidth: 360, aspectRatio: "0.5", background: "#2a2a3e", borderRadius: 40, border: "2px solid #444" }}>
          {/* Body parts */}
          {BODY_PARTS.map((part) => {
            const isSelected = selected?.id === part.id
            return (
              <div key={part.id}>
                {/* Hotspot */}
                <div onClick={() => handlePartClick(part)}
                  style={{
                    position: "absolute", left: `${part.x}%`, top: `${part.y}%`,
                    width: `${part.w}%`, height: `${part.h}%`,
                    border: isSelected ? "2px solid #4fc3f7" : "1px solid transparent",
                    borderRadius: 8, cursor: "pointer", transition: "all 0.15s",
                    background: isSelected ? "#4fc3f722" : "transparent",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    color: isSelected ? "#4fc3f7" : "#555", fontSize: 10,
                  }}
                  onMouseEnter={(e) => { if (!isSelected) { (e.currentTarget as HTMLDivElement).style.borderColor = "#666"; (e.currentTarget as HTMLDivElement).style.background = "#ffffff08" } }}
                  onMouseLeave={(e) => { if (!isSelected) { (e.currentTarget as HTMLDivElement).style.borderColor = "transparent"; (e.currentTarget as HTMLDivElement).style.background = "transparent" } }}
                >
                  {part.label}
                </div>

                {/* Op popup */}
                {isSelected && (
                  <div style={{
                    position: "absolute", left: `${part.x + part.w / 2}%`, top: `${part.y}%`,
                    transform: "translate(-50%, -110%)", zIndex: 10,
                    background: "#1a1a2e", border: "1px solid #4fc3f7", borderRadius: 8,
                    padding: "6px 4px", display: "flex", gap: 4, flexWrap: "wrap", justifyContent: "center",
                    minWidth: 120, boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
                  }}>
                    {part.ops.map((op) => (
                      <button key={op.id} onClick={() => performOp(part, op)}
                        style={{
                          padding: "4px 10px", background: activeOp === op.id ? "#4fc3f7" : "#333",
                          border: "none", borderRadius: 4, color: activeOp === op.id ? "#111" : "#ccc",
                          cursor: "pointer", fontSize: 11, whiteSpace: "nowrap",
                          transition: "all 0.1s",
                        }}>
                        {op.label}{op.unit ? ` (${op.unit})` : ""}
                      </button>
                    ))}
                  </div>
                )}

                {/* Result badge */}
                {BODY_PARTS.flatMap((p) => p.ops.map((o) => p.id + ":" + o.id))
                  .filter((key) => key.startsWith(part.id + ":") && results[key])
                  .map((key) => (
                    <div key={key} style={{
                      position: "absolute", right: "-60%", top: `${part.y + part.h / 2}%`,
                      background: "#1a1a2e", border: "1px solid #4fc3f744", borderRadius: 4,
                      padding: "2px 6px", fontSize: 9, color: "#aaa", whiteSpace: "nowrap",
                    }}>
                      {results[key].label}: <span style={{ color: "#4fc3f7" }}>{results[key].value}</span>
                      {results[key].unit ? ` ${results[key].unit}` : ""}
                    </div>
                  ))}
              </div>
            )
          })}

          {/* Face hint */}
          <div style={{ position: "absolute", left: "42%", top: "6%", fontSize: 16, pointerEvents: "none", opacity: 0.3 }}>
            🙂
          </div>
        </div>
      </div>

      {/* Results log */}
      <div style={{
        width: 240, background: "#1a1a2e", borderLeft: "1px solid #333",
        display: "flex", flexDirection: "column", fontFamily: "monospace", fontSize: 11,
      }}>
        <div style={{ padding: "8px 12px", borderBottom: "1px solid #333", color: "#888", fontWeight: 600 }}>
          EXAM RESULTS
        </div>
        <div ref={logRef} style={{ flex: 1, overflow: "auto", padding: "4px 0" }}>
          {Object.entries(results).length === 0 && (
            <div style={{ padding: "12px", color: "#555", textAlign: "center" }}>Click a body part to perform exam</div>
          )}
          {Object.entries(results).map(([key, r]) => (
            <div key={key} style={{ padding: "6px 12px", borderBottom: "1px solid #222" }}>
              <div style={{ color: "#888" }}>{r.label}</div>
              <div style={{ color: "#4fc3f7", fontWeight: 600, fontSize: 13 }}>
                {r.value}<span style={{ color: "#666", fontWeight: 400, fontSize: 10, marginLeft: 4 }}>{r.unit}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
