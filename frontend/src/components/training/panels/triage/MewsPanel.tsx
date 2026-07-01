import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { submitTriage } from "@/api/training";

const CATEGORIES = [
  { id: "red", label: "红色 — 即刻", color: "bg-red-500", priority: "需立即抢救", textColor: "text-red-700", bg: "bg-red-50" },
  { id: "orange", label: "橙色 — 危急", color: "bg-orange-500", priority: "10分钟内处理", textColor: "text-orange-700", bg: "bg-orange-50" },
  { id: "yellow", label: "黄色 — 紧急", color: "bg-yellow-500", priority: "30分钟内处理", textColor: "text-yellow-700", bg: "bg-yellow-50" },
  { id: "green", label: "绿色 — 普通", color: "bg-green-500", priority: "可等待", textColor: "text-green-700", bg: "bg-green-50" },
  { id: "blue", label: "蓝色 — 非急", color: "bg-blue-500", priority: "可延迟", textColor: "text-blue-700", bg: "bg-blue-50" },
];

const DEPARTMENTS = ["内科", "外科", "妇产科", "儿科", "急诊科", "ICU", "骨科", "神经科"];

interface MewsPanelProps {
  recordId: string;
}

export function MewsPanel({ recordId }: MewsPanelProps) {
  const [mews, setMews] = useState(0);
  const [category, setCategory] = useState("");
  const [department, setDepartment] = useState("");
  const [notes, setNotes] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const submitMutation = useMutation({
    mutationFn: () => submitTriage(Number(recordId), { mews_score: mews, category, department, notes }),
    onSuccess: () => setSubmitted(true),
  });

  const mewsUrgency = mews >= 5 ? "red" : mews >= 3 ? "orange" : "";

  if (submitted) {
    const cat = CATEGORIES.find((c) => c.id === category);
    return (
      <div style={{ padding: 16, textAlign: "center" }}>
        <div style={{ fontSize: 32, marginBottom: 8 }}>✅</div>
        <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 4 }}>分诊完成</div>
        <div style={{ fontSize: 13, color: "#666", marginBottom: 8 }}>MEWS {mews}/14 · {cat?.label ?? category}</div>
        <div style={{ fontSize: 12, color: "#999" }}>建议科室: {department}</div>
      </div>
    );
  }

  return (
    <div style={{ padding: 12, fontFamily: "system-ui", fontSize: 13 }}>
      {/* MEWS */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 8 }}>MEWS 评分</div>
        <div style={{
          background: mewsUrgency === "red" ? "#fff0f0" : mewsUrgency === "orange" ? "#fff5e6" : "#f5f5f5",
          borderRadius: 10, padding: 12, textAlign: "center",
        }}>
          <div style={{ fontSize: 32, fontWeight: 700 }}>{mews}<span style={{ fontSize: 16, fontWeight: 400, color: "#999" }}>/14</span></div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 12, marginTop: 8 }}>
            <button onClick={() => setMews(Math.max(0, mews - 1))}
              style={{ width: 32, height: 32, borderRadius: "50%", border: "1px solid #ddd", background: "#fff", cursor: "pointer", fontSize: 18 }}>−</button>
            <input type="number" min={0} max={14} value={mews} onChange={(e) => setMews(Math.min(14, Math.max(0, Number(e.target.value))))}
              style={{ width: 48, textAlign: "center", fontSize: 16, border: "1px solid #ddd", borderRadius: 6, padding: "4px 0" }} />
            <button onClick={() => setMews(Math.min(14, mews + 1))}
              style={{ width: 32, height: 32, borderRadius: "50%", border: "1px solid #ddd", background: "#fff", cursor: "pointer", fontSize: 18 }}>+</button>
          </div>
        </div>
      </div>

      {/* Category */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 8 }}>分诊级别</div>
        {CATEGORIES.map((c) => (
          <button key={c.id} onClick={() => setCategory(c.id)}
            style={{
              display: "block", width: "100%", padding: "8px 10px", marginBottom: 4, borderRadius: 8,
              border: category === c.id ? "2px solid #333" : "1px solid #e0e0e0",
              background: category === c.id ? c.bg : "#fff", cursor: "pointer", textAlign: "left", fontSize: 12,
            }}>
            <span style={{ fontWeight: 600 }}>{c.label}</span>
            <span style={{ color: "#666", marginLeft: 8, fontSize: 11 }}>{c.priority}</span>
          </button>
        ))}
      </div>

      {/* Department */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 8 }}>建议科室</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
          {DEPARTMENTS.map((dep) => (
            <button key={dep} onClick={() => setDepartment(dep)}
              style={{
                padding: "6px 0", borderRadius: 6, border: department === dep ? "2px solid #4fc3f7" : "1px solid #e0e0e0",
                background: department === dep ? "#e6f7ff" : "#fff", cursor: "pointer", fontSize: 12,
              }}>
              {dep}
            </button>
          ))}
        </div>
      </div>

      {/* Notes */}
      <textarea value={notes} onChange={(e) => setNotes(e.target.value)}
        placeholder="记录观察要点..." rows={3}
        style={{ width: "100%", padding: 8, border: "1px solid #ddd", borderRadius: 6, fontSize: 12, resize: "none", marginBottom: 12 }} />

      {/* Submit */}
      <button onClick={() => submitMutation.mutate()} disabled={!category || !department || submitMutation.isPending}
        style={{
          width: "100%", padding: "10px 0", border: "none", borderRadius: 8,
          background: !category || !department ? "#ccc" : "#333", color: "#fff",
          cursor: !category || !department ? "not-allowed" : "pointer", fontSize: 14, fontWeight: 600,
        }}>
        {submitMutation.isPending ? "提交中..." : "完成分诊"}
      </button>
    </div>
  );
}
