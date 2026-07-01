import type { SceneCardProps } from "../scene-types"

export default function PatientInfoCard(_props: SceneCardProps) {
  return (
    <div style={{ padding: "12px", fontFamily: "system-ui", color: "#ccc", fontSize: 13 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 12, borderBottom: "1px solid #333", paddingBottom: 10 }}>
        <div style={{ width: 40, height: 40, borderRadius: "50%", background: "#4fc3f722", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>👤</div>
        <div>
          <div style={{ fontWeight: 600, color: "#e0e0e0" }}>张明</div>
          <div style={{ fontSize: 12, color: "#888" }}>58岁 · 男</div>
          <div style={{ fontSize: 12, color: "#888" }}>胸痛伴气促3天</div>
        </div>
      </div>
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
        <Tag label="正常" />
        <Tag label="健谈" />
      </div>
    </div>
  )
}

function Tag({ label }: { label: string }) {
  return <span style={{ padding: "2px 8px", fontSize: 11, borderRadius: 10, background: "#2a2a3e", color: "#888" }}>{label}</span>
}
