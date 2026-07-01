import { useState } from "react"
import type { SceneCardProps } from "../../scene-types"

const MOCK_NOTES = [
  { id: 1, type: "free", title: "初步印象", content: "患者面色苍白，呼吸稍急促，主诉胸痛3天。需重点关注心血管系统。" },
  { id: 2, type: "reflection", title: "训练反思", content: "问诊时应该更系统地询问既往病史，特别是心血管相关疾病史。" },
]

export default function NotesCard(_props: SceneCardProps) {
  const [notes] = useState(MOCK_NOTES)

  return (
    <div style={{ padding: "12px", fontFamily: "system-ui", fontSize: 13 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
        <span style={{ color: "#888", fontSize: 12 }}>{notes.length} 条笔记</span>
      </div>
      {notes.length === 0 && <p style={{ color: "#555", textAlign: "center", padding: 20, fontSize: 12 }}>暂无笔记</p>}
      {notes.map((note) => (
        <div key={note.id} style={{ border: "1px solid #2a2a3e", borderRadius: 8, padding: 10, marginBottom: 8 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
            <span style={{ fontSize: 11, color: "#666", background: "#1a1a2e", padding: "1px 6px", borderRadius: 4 }}>{note.type === "free" ? "自由" : note.type}</span>
          </div>
          <div style={{ fontWeight: 500, color: "#e0e0e0", marginBottom: 2, fontSize: 12 }}>{note.title}</div>
          <div style={{ color: "#888", fontSize: 11, lineHeight: 1.4 }}>{note.content}</div>
        </div>
      ))}
    </div>
  )
}
