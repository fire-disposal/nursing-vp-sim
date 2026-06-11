import { Activity, Heart, Loader2, Stethoscope, Zap } from "lucide-react";
import { useCallback, useState } from "react";
import { api } from "@/api/axios-instance";
import type { PanelTabProps } from "@/engine/types";
import { cn } from "@/lib/utils";

interface ExamResult {
  type: string;
  label: string;
  value: string;
  unit: string;
}

interface ExamEntry {
  op: string;
  label: string;
  value: string;
  unit: string;
}

const EXAM_GROUPS: Array<{ label: string; icon: typeof Activity; ops: Array<{ id: string; label: string }> }> = [
  {
    label: "生命体征",
    icon: Heart,
    ops: [
      { id: "vitals", label: "全部体征" },
      { id: "temp", label: "体温" },
      { id: "hr", label: "心率" },
      { id: "rr", label: "呼吸" },
    ],
  },
  {
    label: "循环/氧合",
    icon: Zap,
    ops: [
      { id: "bp", label: "血压" },
      { id: "spo2", label: "血氧" },
    ],
  },
  {
    label: "体格检查",
    icon: Stethoscope,
    ops: [
      { id: "skin", label: "皮肤" },
      { id: "pain", label: "疼痛评分" },
    ],
  },
];

function valueLine(r: ExamEntry): string {
  return r.unit ? `${r.value} ${r.unit}` : r.value;
}

export function ExamPanel({ ctx }: PanelTabProps) {
  const [results, setResults] = useState<Record<string, ExamResult>>({});
  const [history, setHistory] = useState<ExamEntry[]>([]);
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const performExam = useCallback(
    async (opId: string) => {
      if (ctx.loading || loading) return;
      setLoading(opId);
      setError(null);
      try {
        const res = await api.post(`/training/${ctx.recordId}/exam/${opId}`);
        const data = res.data as { type: string; data: ExamResult; all_results: ExamEntry[] };
        setResults((prev) => ({ ...prev, [opId]: data.data }));
        setHistory(data.all_results || []);
      } catch (e: unknown) {
        const err = e as any;
        const detail = err?.response?.data?.detail || err?.message || "操作失败";
        setError(detail);
      } finally {
        setLoading(null);
      }
    },
    [ctx.recordId, ctx.loading, loading],
  );

  return (
    <div className="space-y-4">
      {EXAM_GROUPS.map((group) => (
        <div key={group.label}>
          <h4 className="text-[0.65rem] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5 flex items-center gap-1">
            <group.icon size={12} />
            {group.label}
          </h4>
          <div className="grid grid-cols-2 gap-1">
            {group.ops.map((op) => {
              const done = results[op.id] !== undefined;
              const isActive = loading === op.id;
              return (
                <button
                  type="button"
                  key={op.id}
                  onClick={() => performExam(op.id)}
                  disabled={!!loading || ctx.loading}
                  className={cn(
                    "rounded-lg border px-2.5 py-2 text-xs font-medium transition-colors disabled:opacity-50 text-left flex items-center gap-1.5",
                    done
                      ? "border-green-300 bg-green-50 text-green-700 dark:border-green-800 dark:bg-green-950 dark:text-green-400"
                      : "border-border bg-card hover:bg-muted",
                  )}
                >
                  {isActive ? (
                    <Loader2 size={12} className="animate-spin shrink-0" />
                  ) : done ? (
                    <span className="text-green-500 shrink-0 text-[10px]">&#10003;</span>
                  ) : (
                    <Stethoscope size={12} className="text-muted-foreground shrink-0" />
                  )}
                  {op.label}
                </button>
              );
            })}
          </div>
        </div>
      ))}

      {error && <div className="rounded-lg border border-red-200 bg-red-50 p-2 text-[0.65rem] text-red-600">{error}</div>}

      {history.length > 0 && (
        <div className="space-y-1.5">
          <h4 className="text-[0.65rem] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1">
            <Activity size={12} />
            已查体征 ({history.length})
          </h4>
          {history.map((item, i) => (
            <div key={i} className="flex items-center justify-between rounded-lg border bg-muted/20 px-2.5 py-1.5 text-xs">
              <span className="font-medium">{item.label}</span>
              <span className="tabular-nums text-muted-foreground ml-2">{valueLine(item)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
