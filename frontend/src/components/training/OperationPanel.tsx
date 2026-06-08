import { Activity, ChevronDown, ChevronUp, Droplets, Heart, Thermometer, Zap } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

interface OperationResult {
  type: string;
  label: string;
  value: string;
  unit?: string;
}

interface OperationPanelProps {
  onOperation: (command: string) => void;
  results: OperationResult[];
  disabled?: boolean;
}

const OPERATIONS = [
  {
    id: "vitals",
    label: "生命体征",
    icon: Activity,
    command: "/vitals",
    shortcut: "测生命体征",
  },
  {
    id: "bp",
    label: "血压",
    icon: Heart,
    command: "/bp",
    shortcut: "测血压",
  },
  {
    id: "temp",
    label: "体温",
    icon: Thermometer,
    command: "/temp",
    shortcut: "测体温",
  },
  {
    id: "spo2",
    label: "血氧",
    icon: Activity,
    command: "/spo2",
    shortcut: "测血氧",
  },
  {
    id: "hr",
    label: "心率",
    icon: Zap,
    command: "/hr",
    shortcut: "测心率",
  },
  {
    id: "skin",
    label: "皮肤",
    icon: Droplets,
    command: "/skin",
    shortcut: "观察皮肤",
  },
];

export default function OperationPanel({ onOperation, results, disabled }: OperationPanelProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-xl border border-border bg-card">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center justify-between px-4 py-2.5 text-sm font-medium hover:bg-muted/50 transition-colors rounded-t-xl"
      >
        <span className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-muted-foreground" />
          护理操作
        </span>
        {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
      </button>

      {expanded && (
        <div className="border-t border-border px-3 py-2 space-y-1.5">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-1">
            {OPERATIONS.map((op) => (
              <button
                key={op.id}
                onClick={() => onOperation(op.shortcut)}
                disabled={disabled}
                className="flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-xs font-medium border border-border hover:bg-muted transition-colors disabled:opacity-50"
              >
                <op.icon className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate text-xs sm:text-sm">{op.label}</span>
              </button>
            ))}
          </div>

          {results.length > 0 && (
            <div className="mt-2 pt-2 border-t border-border space-y-1">
              {results.map((r, i) => (
                <div key={i} className="rounded bg-muted/50 px-2.5 py-1.5 text-xs">
                  <span className="font-medium text-muted-foreground">{r.label}: </span>
                  <span className={cn(r.type === "vitals" && "font-mono")}>{r.value}</span>
                  {r.unit && <span className="text-muted-foreground ml-0.5">{r.unit}</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
