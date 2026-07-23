import { useCallback, useEffect, useRef, useState } from "react";
import { type MonitorStatus, PatientMonitor } from "@/components/training/PatientMonitor";
import type { SceneState } from "@/engine/scene-state";
import type { TrainingToolProps } from "@/engine/TrainingTool";
import { useSceneStateValue } from "@/engine/useSceneBus";
import { cn } from "@/utils/cn";

const NORMALS: Record<string, { label: string; unit: string; normal: string; cat: string }> = {
  temp:  { label: "体温",      unit: "°C",    normal: "36.8",   cat: "vital" },
  hr:    { label: "心率",      unit: "次/分", normal: "76",     cat: "vital" },
  rr:    { label: "呼吸频率",   unit: "次/分", normal: "18",     cat: "vital" },
  bp:    { label: "血压",      unit: "mmHg",  normal: "120/80", cat: "vital" },
  spo2:  { label: "血氧饱和度", unit: "%",     normal: "98",     cat: "vital" },
  pain:  { label: "疼痛评分",   unit: "/10",   normal: "0",      cat: "vital" },
  skin:  { label: "皮肤检查",   unit: "",      normal: "未见异常", cat: "inspection" },
};

const CAT_COLOR: Record<string, string> = {
  vital: "#4fc3f7", inspection: "#7c4dff",
};

interface Part { id: string; label: string; x: number; y: number; w: number; h: number; ops: string[] }
const PARTS: Part[] = [
  { id: "head",    label: "头部",   x: 38, y: 2,  w: 24, h: 18, ops: ["temp","pain"] },
  { id: "chest",   label: "胸部",   x: 30, y: 24, w: 40, h: 26, ops: ["hr","rr","spo2", "skin"] },
  { id: "arm_l",   label: "左上肢", x: 8,  y: 26, w: 18, h: 36, ops: ["bp"] },
  { id: "arm_r",   label: "右上肢", x: 74, y: 26, w: 18, h: 36, ops: ["bp","skin"] },
  { id: "abdomen", label: "腹部",   x: 34, y: 52, w: 32, h: 18, ops: ["pain"] },
  { id: "leg_l",   label: "左下肢", x: 22, y: 72, w: 22, h: 26, ops: ["skin"] },
  { id: "leg_r",   label: "右下肢", x: 56, y: 72, w: 22, h: 26, ops: ["skin"] },
];

function groupByCat(ops: string[]): [string, string[]][] {
  const m = new Map<string, string[]>();
  for (const id of ops) {
    const c = NORMALS[id]?.cat ?? "other";
    if (!m.has(c)) m.set(c, []);
    m.get(c)!.push(id);
  }
  return [...m.entries()];
}

function classify(v: SceneState["vitals"]): MonitorStatus {
  return {
    hr: !v?.hr ? "normal" : v.hr > 100 ? "tachycardia" : v.hr < 55 ? "bradycardia" : "normal",
    spo2: !v?.spo2 ? "normal" : v.spo2 < 90 ? "critical" : v.spo2 < 95 ? "low" : "normal",
    bp: !v?.bp_sys ? "normal" : v.bp_sys > 160 ? "hypertensive" : v.bp_sys > 130 ? "elevated" : "normal",
    rr: !v?.rr ? "normal" : v.rr > 24 ? "tachypnea" : v.rr < 10 ? "bradypnea" : "normal",
    temp: !v?.temp ? "normal" : v.temp > 38 ? "fever" : v.temp < 36 ? "hypothermia" : "normal",
    pain: !v?.pain ? "none" : v.pain > 7 ? "severe" : v.pain > 4 ? "moderate" : v.pain > 0 ? "mild" : "none",
  };
}

export default function PhysicalExamTool(props: TrainingToolProps) {
  const { bus, recordId, recordDetail } = props;
  const rid = Number(recordId);
  const sceneState = useSceneStateValue();
  const status = classify(sceneState.vitals);
  const [results, setResults] = useState<Record<string, { value: string }>>({});
  const [selected, setSelected] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const seededRef = useRef(false);
  useEffect(() => {
    if (seededRef.current || !recordDetail) return;
    const prior = recordDetail.exam_results;
    if (Array.isArray(prior) && prior.length > 0) {
      const seeded: Record<string, { value: string }> = {};
      for (const e of prior) {
        if (e?.type) seeded[e.type] = { value: String(e.value ?? "") };
      }
      setResults(seeded);
    }
    seededRef.current = true;
  }, [recordDetail]);

  useEffect(() => {
    const onToolResult = (payload: { tool: string; action: string; ok: boolean; data: Record<string, unknown> }) => {
      if (payload.tool !== "physical_exam" || payload.action !== "measure") return;
      if (!payload.ok) return;
      const data = payload.data as { op_type?: string; result?: { label?: string; value?: string; unit?: string } };
      if (data.op_type && data.result?.value) {
        setResults((prev) => ({ ...prev, [data.op_type!]: { value: data.result!.value! } }));
      }
    };
    bus.on("tool:result", onToolResult);
    return () => { bus.off("tool:result", onToolResult); };
  }, [bus]);

  const interact = useCallback((opId: string) => {
    if (!NORMALS[opId]) return;
    setFlash(opId);
    setResults((prev) => ({ ...prev, [opId]: { value: "检测中…" } }));
    if (rid > 0) {
      bus.emit("tool:invoke", {
        tool: "physical_exam",
        action: "measure",
        params: { op_type: opId },
        recordId: rid,
      });
    }
    setSelected(null);
    setTimeout(() => setFlash(null), 350);
  }, [rid, bus]);

  return (
    <div className="flex flex-col h-full bg-background">
      <div className="px-2 pt-2 shrink-0">
        <PatientMonitor status={status} vitals={sceneState.vitals} />
      </div>

      <div className="flex-1 relative flex items-center justify-center min-h-[280px]">
        <div className="relative w-[50%] max-w-[280px] aspect-[0.48] bg-muted rounded-[60px_60px_30px_30px] border-2 border-border">
          {PARTS.map((part) => {
            const sel = selected === part.id;
            return (
              <div key={part.id}>
                <div onClick={() => setSelected(sel ? null : part.id)}
                  onMouseEnter={(e) => { if (!sel) { (e.currentTarget as HTMLDivElement).style.borderColor = "var(--color-border)"; (e.currentTarget as HTMLDivElement).style.background = "var(--color-accent)"; }}}
                  onMouseLeave={(e) => { if (!sel) { (e.currentTarget as HTMLDivElement).style.borderColor = "transparent"; (e.currentTarget as HTMLDivElement).style.background = "transparent"; }}}
                  className={cn(
                    "absolute flex items-center justify-center rounded-lg cursor-pointer transition-all text-[10px] font-medium border",
                    sel ? "border-primary bg-primary/10 text-primary" : "border-transparent text-muted-foreground/60 hover:border-border hover:bg-accent",
                  )}
                  style={{ left: `${part.x}%`, top: `${part.y}%`, width: `${part.w}%`, height: `${part.h}%` }}
                >
                  {part.label}
                </div>

                {sel && (
                  <div className="absolute z-10 bg-popover border border-border rounded-xl shadow-xl p-2"
                    style={{ left: `${part.x + part.w / 2}%`, top: `${part.y + part.h / 2}%`, transform: "translate(-50%, -50%)", minWidth: 160 }}
                  >
                    {groupByCat(part.ops).map(([cat, ids]) => (
                      <div key={cat} className="mb-1.5">
                        <div className="text-[9px] text-muted-foreground mb-1 font-semibold">{cat}</div>
                        <div className="flex gap-1 flex-wrap">
                          {ids.map((id) => {
                            const def = NORMALS[id];
                            if (!def) return null;
                            return (
                              <button key={id} onClick={() => interact(id)}
                                className={cn(
                                  "px-2 py-0.5 rounded text-[10px] whitespace-nowrap transition-all cursor-pointer border",
                                  flash === id ? "text-foreground" : "text-foreground",
                                )}
                                style={{
                                  background: flash === id ? (CAT_COLOR[def.cat] ?? "#888") : "var(--color-muted)",
                                  borderColor: `${CAT_COLOR[def.cat] ?? "#888"}44`,
                                }}
                              >
                                {def.label}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="h-9 border-t border-border bg-card flex items-center gap-1.5 px-2 overflow-x-auto shrink-0">
        {Object.keys(results).length === 0 ? (
          <span className="text-xs text-muted-foreground/60 px-1">点击人体部位选择检查项目</span>
        ) : (
          Object.entries(results).map(([id, r]) => {
            const def = NORMALS[id];
            if (!def) return null;
            return (
              <span key={id} className={cn(
                "inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] whitespace-nowrap shrink-0",
                "bg-muted text-muted-foreground",
              )}>
                <span className="size-1.5 rounded-full shrink-0" style={{ background: CAT_COLOR[def.cat] ?? "#888" }} />
                {def.label} <span className="font-semibold">{r.value}</span>{def.unit}
              </span>
            );
          })
        )}
      </div>
    </div>
  );
}
