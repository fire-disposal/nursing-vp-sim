import { useState } from "react"
import type { SceneCardProps } from "../../scene-types"

const MOCK_INQUIRIES = [
  "询问患者胸痛的性质、部位、持续时间",
  "了解患者有无高血压、糖尿病等既往病史",
  "询问患者有无吸烟、饮酒等生活习惯",
  "了解患者有无过敏史",
  "询问患者近期用药情况",
]

export default function InquiryCard(_props: SceneCardProps) {
  const [done] = useState<Set<string>>(new Set())

  return (
    <div style={{ padding: "12px", fontFamily: "system-ui", fontSize: 13 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
        <span style={{ color: "#888", fontSize: 12 }}>问诊目标 ({done.size}/{MOCK_INQUIRIES.length})</span>
      </div>
      {MOCK_INQUIRIES.map((inq, i) => {
        const isDone = done.has(inq)
        return (
          <div key={i} style={{ display: "flex", gap: 8, padding: "6px 0", alignItems: "flex-start", opacity: isDone ? 0.5 : 1 }}>
            <span style={{ color: isDone ? "#4fc3f7" : "#555", fontSize: 14, marginTop: 1 }}>{isDone ? "✓" : "○"}</span>
            <span style={{ color: isDone ? "#666" : "#ccc", fontSize: 12, textDecoration: isDone ? "line-through" : "none" }}>{inq}</span>
          </div>
        )
      })}
    </div>
  )
}
