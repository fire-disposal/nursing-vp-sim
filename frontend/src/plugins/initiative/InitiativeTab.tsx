import { useEffect, useState } from "react";
import type { PanelTabProps } from "@/engine/types";
import { cn } from "@/lib/utils";

interface InitiativeState {
  elapsed_seconds?: number;
  threshold_seconds?: number;
  percent?: number;
  should_trigger?: boolean;
}

export function InitiativeTab({ ctx }: PanelTabProps) {
  const [state, setState] = useState<InitiativeState>({});
  const [hasPending, setHasPending] = useState(false);

  useEffect(() => {
    const unsub1 = ctx.bus.on("initiative:state", (s: InitiativeState) => setState(s));
    const unsub2 = ctx.bus.on("initiative:triggered", () => setHasPending(true));

    return () => {
      unsub1();
      unsub2();
    };
  }, [ctx.bus]);

  useEffect(() => {
    if (hasPending) {
      const t = setTimeout(() => setHasPending(false), 10000);
      return () => clearTimeout(t);
    }
  }, [hasPending]);

  return (
    <div className="space-y-4">
      <div className="text-center">
        <div
          className={cn(
            "inline-flex items-center gap-2 px-4 py-2 rounded-full text-xs font-medium",
            hasPending ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground",
          )}
        >
          {hasPending ? "有追问待处理" : "患者状态正常"}
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>距下次可能追问</span>
          <span className="tabular-nums">
            {state.elapsed_seconds != null ? `${Math.round(state.elapsed_seconds)}s / ${Math.round(state.threshold_seconds || 60)}s` : "计算中..."}
          </span>
        </div>
        <div className="h-1.5 rounded-full bg-muted overflow-hidden">
          <div
            className={cn("h-full rounded-full transition-all duration-1000", (state.percent ?? 0) > 80 ? "bg-destructive" : "bg-primary")}
            style={{ width: `${Math.min(100, state.percent ?? 0)}%` }}
          />
        </div>
      </div>
    </div>
  );
}
