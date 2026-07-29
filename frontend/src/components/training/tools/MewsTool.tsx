import { useCallback, useEffect, useRef, useState } from "react";
import type { TrainingToolProps } from "@/engine/TrainingTool";
import { useSceneStateValue } from "@/engine/useSceneBus";
import { calcMews } from "@/utils/mews";

const CATEGORIES = [
  { id: "red",    label: "红色 — 即刻", priority: "需立即抢救", border: "border-red-500/40", activeBg: "bg-red-50 dark:bg-red-950/30", dot: "bg-red-500" },
  { id: "orange", label: "橙色 — 危急", priority: "10分钟内处理", border: "border-orange-500/40", activeBg: "bg-orange-50 dark:bg-orange-950/30", dot: "bg-orange-500" },
  { id: "yellow", label: "黄色 — 紧急", priority: "30分钟内处理", border: "border-yellow-500/40", activeBg: "bg-yellow-50 dark:bg-yellow-950/30", dot: "bg-yellow-500" },
  { id: "green",  label: "绿色 — 普通", priority: "可等待", border: "border-green-500/40", activeBg: "bg-green-50 dark:bg-green-950/30", dot: "bg-green-500" },
  { id: "blue",   label: "蓝色 — 非急", priority: "可延迟", border: "border-blue-500/40", activeBg: "bg-blue-50 dark:bg-blue-950/30", dot: "bg-blue-500" },
];

const DEPARTMENTS = ["内科", "外科", "妇产科", "儿科", "急诊科", "ICU", "骨科", "神经科"];

export default function MewsTool(props: TrainingToolProps) {
  const { bus, recordId, recordDetail } = props;
  const rid = Number(recordId);
  const sceneState = useSceneStateValue();
  const mews = calcMews({
    hr: sceneState.vitals?.hr,
    sbp: sceneState.vitals?.bp_sys,
    rr: sceneState.vitals?.rr,
    temp: sceneState.vitals?.temp,
    consciousness: sceneState.patient?.consciousness as "alert" | "confused" | "unresponsive" | undefined,
  });
  const [category, setCategory] = useState("");
  const [department, setDepartment] = useState("");
  const [notes, setNotes] = useState("");
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  // Load initial vitals from backend via WS
  const loadedRef = useRef(false);
  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;
    bus.emit("tool:invoke", {
      tool: "mews",
      action: "load",
      params: {},
      recordId: rid,
    });
  }, [rid, bus]);

  // Restore saved state from record detail
  const seededRef = useRef(false);
  useEffect(() => {
    if (seededRef.current || !recordDetail) return;
    const rs = (recordDetail as Record<string, unknown>).runtime_state as Record<string, unknown> | undefined;
    const calc = rs?.mews_calculation as { category?: string; department?: string; notes?: string } | undefined;
    if (calc?.category) {
      setCategory(calc.category);
      setDepartment(calc.department ?? "");
      setNotes(calc.notes ?? "");
      setSaved(true);
    }
    seededRef.current = true;
  }, [recordDetail]);

  const handleSave = useCallback(() => {
    setSaving(true);
    bus.emit("tool:invoke", {
      tool: "mews",
      action: "save",
      params: { scores: { mews_score: mews, category, department, notes } },
      recordId: rid,
    });
    setSaved(true);
    setSaving(false);
  }, [bus, rid, mews, category, department, notes]);

  const mewsUrgency = mews >= 5 ? "red" : mews >= 3 ? "orange" : "";
  const mewsBg = mewsUrgency === "red" ? "bg-red-50 dark:bg-red-950/20"
    : mewsUrgency === "orange" ? "bg-orange-50 dark:bg-orange-950/20"
    : "bg-muted";

  if (saved) {
    const cat = CATEGORIES.find((c) => c.id === category);
    return (
      <div className="p-4 text-center space-y-1">
        <div className="font-bold text-base">分诊已保存</div>
        <div className="text-sm text-muted-foreground">MEWS {mews}/14 · {cat?.label ?? category}</div>
        <div className="text-xs text-muted-foreground/70">建议科室: {department}</div>
      </div>
    );
  }

  return (
    <div className="p-3 space-y-4 text-sm">
      <div>
        <div className="font-semibold text-sm">MEWS 评分（由生命体征自动计算）</div>
        <div className={`${mewsBg} rounded-xl p-3 text-center`}>
          <div className="text-3xl font-bold">{mews}<span className="text-base font-normal text-muted-foreground">/14</span></div>
          <div className="text-[11px] text-muted-foreground/70 mt-1">HR/BP/RR/TEMP/意识 实测值联动</div>
        </div>
      </div>

      <div>
        <div className="font-semibold text-sm mb-1.5">分诊级别</div>
        <div className="space-y-1">
          {CATEGORIES.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setCategory(c.id)}
              className={`w-full text-left px-3 py-2 rounded-lg border text-sm transition-colors ${
                category === c.id
                  ? `${c.activeBg} ${c.border}`
                  : "border-border hover:bg-muted"
              }`}
            >
              <span className="font-medium">{c.label}</span>
              <span className="text-muted-foreground ml-2 text-xs">{c.priority}</span>
            </button>
          ))}
        </div>
      </div>

      <div>
        <div className="font-semibold text-sm mb-1.5">建议科室</div>
        <select
          value={department}
          onChange={(e) => setDepartment(e.target.value)}
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
        >
          <option value="">请选择科室</option>
          {DEPARTMENTS.map((d) => (
            <option key={d} value={d}>{d}</option>
          ))}
        </select>
      </div>

      <button
        type="button"
        onClick={handleSave}
        disabled={!category || saving}
        className="w-full rounded-lg bg-primary text-primary-foreground py-2 text-sm font-medium disabled:opacity-40"
      >
        {saving ? "保存中..." : "保存分诊结果"}
      </button>
    </div>
  );
}
