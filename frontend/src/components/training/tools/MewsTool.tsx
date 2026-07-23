import { useMutation } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { submitTriage } from "@/api/training";
import type { TrainingToolProps } from "@/engine/TrainingTool";
import { useSceneStateValue } from "@/engine/useSceneBus";
import { calcMews, type MewsInput } from "@/utils/mews";

const CATEGORIES = [
  { id: "red",    label: "红色 — 即刻", priority: "需立即抢救", border: "border-red-500/40", activeBg: "bg-red-50 dark:bg-red-950/30", dot: "bg-red-500" },
  { id: "orange", label: "橙色 — 危急", priority: "10分钟内处理", border: "border-orange-500/40", activeBg: "bg-orange-50 dark:bg-orange-950/30", dot: "bg-orange-500" },
  { id: "yellow", label: "黄色 — 紧急", priority: "30分钟内处理", border: "border-yellow-500/40", activeBg: "bg-yellow-50 dark:bg-yellow-950/30", dot: "bg-yellow-500" },
  { id: "green",  label: "绿色 — 普通", priority: "可等待", border: "border-green-500/40", activeBg: "bg-green-50 dark:bg-green-950/30", dot: "bg-green-500" },
  { id: "blue",   label: "蓝色 — 非急", priority: "可延迟", border: "border-blue-500/40", activeBg: "bg-blue-50 dark:bg-blue-950/30", dot: "bg-blue-500" },
];

const DEPARTMENTS = ["内科", "外科", "妇产科", "儿科", "急诊科", "ICU", "骨科", "神经科"];

export default function MewsTool(props: TrainingToolProps) {
  const sceneState = useSceneStateValue();
  const mews = calcMews({
    hr: sceneState.vitals?.hr,
    sbp: sceneState.vitals?.bp_sys,
    rr: sceneState.vitals?.rr,
    temp: sceneState.vitals?.temp,
    consciousness: sceneState.patient?.consciousness as MewsInput["consciousness"],
  });
  const [category, setCategory] = useState("");
  const [department, setDepartment] = useState("");
  const [notes, setNotes] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const seededRef = useRef(false);
  useEffect(() => {
    if (seededRef.current || !props.recordDetail) return;
    const tr = props.recordDetail.triage_result as { category?: string; department?: string; notes?: string } | undefined;
    if (tr && (tr.category || tr.department)) {
      setCategory(tr.category ?? "");
      setDepartment(tr.department ?? "");
      setNotes(tr.notes ?? "");
      setSubmitted(true);
    }
    seededRef.current = true;
  }, [props.recordDetail]);

  const submitMutation = useMutation({
    mutationFn: () => submitTriage(Number(props.recordId), { mews_score: mews, category, department, notes }),
    onSuccess: () => setSubmitted(true),
  });

  const mewsUrgency = mews >= 5 ? "red" : mews >= 3 ? "orange" : "";
  const mewsBg = mewsUrgency === "red" ? "bg-red-50 dark:bg-red-950/20"
    : mewsUrgency === "orange" ? "bg-orange-50 dark:bg-orange-950/20"
    : "bg-muted";

  if (submitted) {
    const cat = CATEGORIES.find((c) => c.id === category);
    return (
      <div className="p-4 text-center space-y-1">
        <div className="text-3xl mb-1">✅</div>
        <div className="font-bold text-base">分诊完成</div>
        <div className="text-sm text-muted-foreground">MEWS {mews}/14 · {cat?.label ?? category}</div>
        <div className="text-xs text-muted-foreground/70">建议科室: {department}</div>
      </div>
    );
  }

  return (
    <div className="p-3 space-y-4 text-sm">
      <div className="space-y-2">
        <div className="font-semibold text-sm">MEWS 评分（由生命体征自动计算）</div>
        <div className={`${mewsBg} rounded-xl p-3 text-center`}>
          <div className="text-3xl font-bold">{mews}<span className="text-base font-normal text-muted-foreground">/14</span></div>
          <div className="text-[11px] text-muted-foreground/70 mt-1">HR/BP/RR/TEMP/意识 实测值联动</div>
        </div>
      </div>

      <div className="space-y-2">
        <div className="font-semibold text-sm">分诊级别</div>
        {CATEGORIES.map((c) => (
          <button key={c.id} onClick={() => setCategory(c.id)}
            className={`w-full text-left text-xs rounded-lg px-3 py-2 transition-colors flex items-center gap-2
              ${category === c.id ? `${c.activeBg} ${c.border} border-2` : "border border-border bg-card hover:bg-muted"}`}>
            <span className={`size-2.5 rounded-full shrink-0 ${c.dot}`} />
            <span className="font-semibold">{c.label}</span>
            <span className="text-muted-foreground text-[11px] ml-auto">{c.priority}</span>
          </button>
        ))}
      </div>

      <div className="space-y-2">
        <div className="font-semibold text-sm">建议科室</div>
        <div className="grid grid-cols-2 gap-1.5">
          {DEPARTMENTS.map((dep) => (
            <button key={dep} onClick={() => setDepartment(dep)}
              className={`rounded-lg py-1.5 text-xs transition-colors
                ${department === dep ? "border-2 border-primary bg-primary/10 text-primary font-semibold" : "border border-border bg-card hover:bg-muted text-foreground"}`}>
              {dep}
            </button>
          ))}
        </div>
      </div>

      <textarea value={notes} onChange={(e) => setNotes(e.target.value)}
        placeholder="记录观察要点..." rows={3}
        className="w-full p-2 border border-border rounded-lg text-xs resize-none bg-card placeholder:text-muted-foreground/50" />

      <button onClick={() => submitMutation.mutate()} disabled={!category || !department || submitMutation.isPending}
        className="w-full py-2.5 rounded-lg text-sm font-semibold transition-colors
          disabled:opacity-50 disabled:cursor-not-allowed
          enabled:bg-primary enabled:text-primary-foreground enabled:hover:opacity-90">
        {submitMutation.isPending ? "提交中..." : "完成分诊"}
      </button>
    </div>
  );
}
