import { Activity, Stethoscope } from "lucide-react";
import { useState } from "react";
import type { PanelTabProps } from "@/engine/types";

const OPERATIONS = [
  { id: "vitals", label: "生命体征", command: "/vitals" },
  { id: "bp", label: "血压", command: "/bp" },
  { id: "temp", label: "体温", command: "/temp" },
  { id: "spo2", label: "血氧", command: "/spo2" },
  { id: "hr", label: "心率", command: "/hr" },
  { id: "rr", label: "呼吸", command: "/rr" },
  { id: "skin", label: "皮肤", command: "/skin" },
  { id: "pain", label: "疼痛评分", command: "/pain" },
];

const LABEL_MAP: Record<string, string> = {
  vitals: "生命体征",
  bp: "血压",
  temp: "体温",
  spo2: "血氧",
  hr: "心率",
  rr: "呼吸",
  skin: "皮肤",
  pain: "疼痛评分",
};

export function ExamPanel({ ctx }: PanelTabProps) {
  const [results, setResults] = useState<Record<string, { type: string; data: Record<string, unknown> }>>({});

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-1.5">
        {OPERATIONS.map((op) => (
          <button
            key={op.id}
            onClick={() => ctx.sendMessage(op.command)}
            disabled={ctx.loading}
            className="rounded-lg border bg-card px-2.5 py-2 text-xs font-medium hover:bg-muted transition-colors disabled:opacity-50 text-left flex items-center gap-1.5"
          >
            <Stethoscope size={13} className="text-muted-foreground shrink-0" />
            {op.label}
          </button>
        ))}
      </div>

      {Object.keys(results).length > 0 && (
        <div className="space-y-2">
          <h4 className="text-xs font-semibold text-muted-foreground">已查体征</h4>
          {Object.entries(results).map(([key, result]) => (
            <div key={key} className="rounded-lg border bg-muted/30 p-2">
              <div className="flex items-center gap-1.5 mb-1">
                <Activity size={12} className="text-primary" />
                <span className="text-xs font-medium">{LABEL_MAP[key] || key}</span>
              </div>
              <div className="grid grid-cols-2 gap-1">
                {Object.entries(result.data).map(([k, v]) => (
                  <div key={k} className="text-[0.65rem]">
                    <span className="text-muted-foreground">{k}: </span>
                    <span className="font-medium">{String(v)}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
