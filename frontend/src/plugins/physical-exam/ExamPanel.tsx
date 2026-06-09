// frontend/src/plugins/physical-exam/ExamPanel.tsx
import { useState } from "react";
import type { SlotProps } from "@/engine/types";

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

export function ExamPanel({ ctx, features }: SlotProps) {
  const [expanded, setExpanded] = useState(false);

  if (!features.physical_exam) return null;

  const execute = (cmd: string) => {
    ctx.sendMessage(cmd);
  };

  return (
    <div className="rounded-lg border bg-card p-3">
      <button onClick={() => setExpanded((v) => !v)} className="flex w-full items-center justify-between text-sm font-medium">
        <span>护理查体操作</span>
        <span className="text-muted-foreground">{expanded ? "▲" : "▼"}</span>
      </button>
      {expanded && (
        <div className="mt-2 grid grid-cols-2 gap-1">
          {OPERATIONS.map((op) => (
            <button key={op.id} onClick={() => execute(op.command)} className="rounded bg-secondary px-2 py-1 text-xs hover:bg-secondary/80">
              {op.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
