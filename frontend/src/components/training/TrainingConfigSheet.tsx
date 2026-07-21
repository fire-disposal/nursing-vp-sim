import { Clock, Minus, Plus, Sparkles, Star, User } from "lucide-react";
import { useState } from "react";
import type { components } from "@/api/api-types.gen";
import Button from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import type { TrainingTypeInfo } from "@/components/training/types";

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
  const [timeLimit, setTimeLimit] = useState(isTriage ? 10 : 20);
  const timeMin = 5;
  const timeMax = isTriage ? 30 : 60;

  const handleStart = () => {
    // 学生端不再展示能力开关：传空 features，让后端从 case_data.capabilities 读取
    onStart({}, timeLimit);
  };

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

          {/* 训练特性提示 — 仅展示，不提供开关 */}
          <div className="flex items-center gap-1.5 px-1">
            <Sparkles size={15} className="text-primary" />
            <span className="text-sm font-medium">训练特性</span>
            <span className="text-[11px] text-muted-foreground">· 由病例自动配置</span>
          </div>

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
            {loading ? "启动中…" : "开始训练"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
