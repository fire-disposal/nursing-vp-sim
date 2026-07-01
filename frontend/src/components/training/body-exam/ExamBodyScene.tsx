import { useCallback, useRef, useState } from "react";
import { cn } from "@/utils/cn";
import { emitSceneEvent, type SceneProps, type SceneState } from "@/engine/scene-state";

// ── Normal values ──
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
};

const CAT_LABEL: Record<string, string> = {
  vital: "生命体征", auscultation: "听诊", neuro: "神经系统",
  musculoskeletal: "骨骼肌肉", bedside: "床旁检测",
};

const CAT_COLOR: Record<string, string> = {
  vital: "#4fc3f7", auscultation: "#7c4dff", neuro: "#ff7043",
  musculoskeletal: "#66bb6a", bedside: "#ffa726",
};

type RandFn = (base: string) => string;
const RANDOMIZERS: Record<string, RandFn> = {
  temp: (b) => { const n = Number(b) + (Math.random() - 0.5) * 0.4; return n.toFixed(1); },
  hr:   (b) => `${Math.round(Number(b) + (Math.random() - 0.5) * 8)}`,
  rr:   (b) => `${Math.round(Number(b) + (Math.random() - 0.5) * 4)}`,
  bp:   (b) => { const [s, d] = b.split("/").map(Number); return `${Math.round(s + (Math.random() - 0.5) * 10)}/${Math.round(d + (Math.random() - 0.5) * 8)}`; },
  spo2: (b) => `${Math.round(Number(b) + (Math.random() - 0.5) * 2)}`,
};

function resolve(opId: string): { value: string; abnormal: boolean } {
  const def = NORMALS[opId];
  if (!def) return { value: "—", abnormal: false };
  const rand = RANDOMIZERS[opId];
  return { value: rand ? rand(def.normal) : def.normal, abnormal: false };
}

// ── Body parts ──
interface Part { id: string; label: string; x: number; y: number; w: number; h: number; ops: string[] }
const PARTS: Part[] = [
  { id: "head",    label: "头部",   x: 38, y: 2,  w: 24, h: 18, ops: ["temp","pain","pupil","gcs"] },
  { id: "chest",   label: "胸部",   x: 30, y: 24, w: 40, h: 26, ops: ["hr","rr","spo2","heart","lung","ecg"] },
  { id: "arm_l",   label: "左上肢", x: 8,  y: 26, w: 18, h: 36, ops: ["bp","glucose","strength"] },
  { id: "arm_r",   label: "右上肢", x: 74, y: 26, w: 18, h: 36, ops: ["bp","glucose","strength"] },
  { id: "abdomen", label: "腹部",   x: 34, y: 52, w: 32, h: 18, ops: ["bowel","pain"] },
  { id: "leg_l",   label: "左下肢", x: 22, y: 72, w: 22, h: 26, ops: ["strength","edema"] },
  { id: "leg_r",   label: "右下肢", x: 56, y: 72, w: 22, h: 26, ops: ["strength","edema"] },
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

// ── Component ──
export default function ExamBodyScene({ bus }: SceneProps) {
  const [results, setResults] = useState<Record<string, { value: string; abnormal: boolean }>>({});
  const [selected, setSelected] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  const interact = useCallback((opId: string) => {
    const def = NORMALS[opId];
    if (!def) return;
    setFlash(opId);
    const { value, abnormal } = resolve(opId);
    setResults((prev) => ({ ...prev, [opId]: { value, abnormal } }));

    emitSceneEvent(bus, "scene:interaction", { hotspotId: selected ?? "", metadata: { op_type: opId, value } });

    const patch: Partial<SceneState> = {};
    if (opId === "hr")   patch.vitals = { hr: Number(value) };
    if (opId === "bp")   { const [s, d] = value.split("/"); patch.vitals = { bp_sys: Number(s), bp_dia: Number(d) }; }
    if (opId === "rr")   patch.vitals = { rr: Number(value) };
    if (opId === "spo2") patch.vitals = { spo2: Number(value) };
    if (opId === "temp") patch.vitals = { temp: Number(value) };
    if (opId === "pain") patch.vitals = { pain: Number(value) };
    if (Object.keys(patch).length) emitSceneEvent(bus, "scene:state", patch);

    setSelected(null);
    setTimeout(() => setFlash(null), 350);
    logRef.current?.scrollTo(0, 0);
  }, [bus, selected]);

  return (
    <div className="flex h-full font-sans bg-background">
      {/* Body diagram */}
      <div className="flex-1 relative flex items-center justify-center">
        <div className="relative w-[55%] max-w-[320px] aspect-[0.48] bg-muted rounded-[60px_60px_30px_30px] border-2 border-border">
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
                    style={{ left: `${part.x + part.w / 2}%`, top: `${part.y}%`, transform: "translate(-50%, -108%)", minWidth: 160 }}
                  >
                    {groupByCat(part.ops).map(([cat, ids]) => (
                      <div key={cat} className="mb-1.5">
                        <div className="text-[9px] text-muted-foreground mb-1 font-semibold">{CAT_LABEL[cat] ?? cat}</div>
                        <div className="flex gap-1 flex-wrap">
                          {ids.map((id) => {
                            const def = NORMALS[id];
                            if (!def) return null;
                            return (
                              <button key={id} onClick={() => interact(id)}
                                className="px-2 py-0.5 rounded text-[10px] whitespace-nowrap transition-all cursor-pointer border"
                                style={{
                                  background: flash === id ? (CAT_COLOR[cat] ?? "#888") : "var(--color-muted)",
                                  borderColor: `${CAT_COLOR[cat] ?? "#888"}44`,
                                  color: flash === id ? "#111" : "var(--color-foreground)",
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
          <div className="absolute left-[44%] top-[6%] text-lg pointer-events-none opacity-10">🙂</div>
        </div>
      </div>

      {/* Results panel */}
      <div className="w-[280px] border-l border-border bg-card flex flex-col font-mono text-xs">
        <div className="px-3.5 py-2.5 border-b border-border text-muted-foreground font-bold text-xs">◈ 检查记录</div>
        <div ref={logRef} className="flex-1 overflow-auto">
          {Object.keys(results).length === 0 && (
            <div className="p-5 text-muted-foreground/60 text-center text-xs">点击人体部位选择检查项目</div>
          )}
          {Object.entries(results).map(([id, r]) => {
            const def = NORMALS[id];
            if (!def) return null;
            return (
              <div key={id} className={cn("px-3.5 py-2 border-b border-border/60", r.abnormal ? "border-l-2 border-l-orange-500" : "border-l-2 border-l-transparent")}>
                <div className="flex items-center gap-1.5 mb-0.5">
                  <span className="inline-block size-1.5 rounded-full shrink-0" style={{ background: CAT_COLOR[def.cat] ?? "#888" }} />
                  <span className="text-muted-foreground text-[10px]">{def.label}</span>
                  <span className="text-muted-foreground/60 text-[9px]">{def.unit}</span>
                  {r.abnormal && <span className="text-orange-500 text-[9px] ml-auto">异常</span>}
                </div>
                <div className={cn("text-xs font-semibold ml-3", r.abnormal ? "text-orange-500" : "text-foreground")}>{r.value}</div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
