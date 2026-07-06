import { Clock, Minus, Plus, Star, User } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import type { components } from "@/api/api-types.gen";
import Button from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { ALL_CAPABILITIES, TRAINING_CAPABILITIES } from "@/engine/capabilities.gen";
import type { TrainingTypeInfo } from "@/training/types";
import { cn } from "@/utils/cn";

type CaseBrief = components["schemas"]["CaseBrief"];

interface Props {
  open: boolean;
  caseInfo: CaseBrief;
  profiles: TrainingTypeInfo[];
  onClose: () => void;
  onStart: (features: Record<string, boolean>, timeLimit: number) => void;
  loading?: boolean;
}

export function TrainingConfigSheet({ open, caseInfo, profiles, onClose, onStart, loading }: Props) {
  const isTriage = caseInfo.training_type === "triage";
  const availableKeys = TRAINING_CAPABILITIES[caseInfo.training_type] ?? [];
  const [toggles, setToggles] = useState<Record<string, boolean>>({});
  const [timeLimit, setTimeLimit] = useState(isTriage ? 10 : 20);
  const timeMin = 5;
  const timeMax = isTriage ? 30 : 60;

  const caps = useMemo(() => {
    const result: Record<string, boolean> = {};
    for (const key of availableKeys) {
      const def = ALL_CAPABILITIES[key];
      result[key] = toggles[key] ?? (def ? def.defaultOn : false);
    }
    return result;
  }, [availableKeys, toggles]);

  const toggle = useCallback((key: string) => {
    setToggles((prev) => {
      const def = ALL_CAPABILITIES[key];
      const current = prev[key] ?? (def ? def.defaultOn : false);
      return { ...prev, [key]: !current };
    });
  }, []);

  const handleStart = useCallback(() => {
    onStart(caps, timeLimit);
  }, [caps, timeLimit, onStart]);

  const profile = profiles.find((p) => p.type === caseInfo.training_type);
  const summary = caseInfo.patient_summary as { gender?: string; age?: number; chief_complaint?: string } | undefined;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="训练配置" maxWidth={480}>
        <div className="flex flex-col gap-5 pb-1">
          {/* Case preview */}
          <div className="rounded-xl border bg-gradient-to-br from-primary/5 to-primary/[0.02] p-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h3 className="font-semibold text-base">{caseInfo.name}</h3>
                {caseInfo.description && (
                  <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{caseInfo.description}</p>
                )}
              </div>
              <span className="flex gap-0.5 shrink-0">
                {[1, 2, 3].map((i) => (
                  <Star key={i} size={14} fill={i <= (caseInfo.difficulty || 1) ? "#f59e0b" : "none"} color={i <= (caseInfo.difficulty || 1) ? "#f59e0b" : "#d1d5db"} />
                ))}
              </span>
            </div>
            {summary && (
              <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs text-muted-foreground">
                {summary.gender && <span className="inline-flex items-center gap-1"><User size={12} />{summary.gender === "男" ? "男性" : "女性"}</span>}
                {typeof summary.age === "number" && <span>{summary.age}岁</span>}
                {summary.chief_complaint && <span className="truncate max-w-[200px]">主诉：{summary.chief_complaint}</span>}
              </div>
            )}
            {profile && <div className="mt-2 text-[11px] text-muted-foreground">{profile.description}</div>}
          </div>

          {/* Capabilities */}
          {availableKeys.length > 0 && (
            <div>
              <span className="text-sm font-medium mb-3 block">训练特性</span>
              <div className="space-y-2">
                {availableKeys.map((key) => {
                  const def = ALL_CAPABILITIES[key];
                  if (!def) return null;
                  const on = caps[key];
                  return (
                    <button key={key} type="button" onClick={() => toggle(key)}
                      className={cn(
                        "flex items-center gap-3 w-full rounded-lg border p-3 text-left transition-all",
                        on ? "border-primary/50 bg-primary/5" : "border-border hover:border-primary/20 hover:bg-muted/50",
                      )}
                    >
                      <div className={cn(
                        "flex size-9 items-center justify-center rounded-lg shrink-0 transition-colors",
                        on ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground",
                      )}>
                        <span className="text-sm font-bold">{def.label.slice(0, 2)}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium">{def.label}</p>
                        <p className="text-[11px] text-muted-foreground">{def.description}</p>
                      </div>
                      <div className={cn("h-5 w-9 rounded-full transition-colors shrink-0", on ? "bg-primary" : "bg-muted-foreground/25")}>
                        <div className={cn("size-4 rounded-full bg-white shadow-sm transition-transform mt-0.5", on ? "translate-x-[18px]" : "translate-x-[2px]")} />
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Triage info */}
          {isTriage && (
            <div className="rounded-xl border border-orange-200 bg-orange-50 p-4">
              <div className="flex items-center gap-3">
                <span className="text-2xl">🚑</span>
                <div>
                  <p className="font-medium text-orange-800">预检分诊训练</p>
                  <p className="text-sm text-orange-600">通过对话收集病情 → 完成 MEWS 评分 → 确定分诊级别</p>
                </div>
              </div>
            </div>
          )}

          {/* Time limit */}
          <div>
            <span className="text-sm font-medium mb-3 block">时长限制</span>
            <div className="flex items-center gap-3 rounded-lg border p-3">
              <Clock size={18} className="text-muted-foreground shrink-0" />
              <div className="flex-1">
                <input type="range" min={timeMin} max={timeMax} step={5} value={timeLimit}
                  onChange={(e) => setTimeLimit(Number(e.target.value))}
                  className="w-full h-2 rounded-full appearance-none bg-muted cursor-pointer accent-primary" />
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button type="button" onClick={() => setTimeLimit((t) => Math.min(timeMax, Math.max(timeMin, t - 5)))}
                  className="size-7 flex items-center justify-center rounded-md hover:bg-muted"><Minus size={14} /></button>
                <span className="w-10 text-center text-sm font-semibold tabular-nums">{timeLimit}</span>
                <button type="button" onClick={() => setTimeLimit((t) => Math.min(timeMax, Math.max(timeMin, t + 5)))}
                  className="size-7 flex items-center justify-center rounded-md hover:bg-muted"><Plus size={14} /></button>
                <span className="text-xs text-muted-foreground">分钟</span>
              </div>
            </div>
          </div>

          <Button onClick={handleStart} disabled={loading} className="w-full h-11 text-base font-semibold" size="lg">
            {loading ? "启动中…" : `开始${isTriage ? "分诊" : "训练"}`}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
