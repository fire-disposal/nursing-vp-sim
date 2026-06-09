import { useEffect, useRef, useState } from "react";
import type { SlotProps } from "@/engine/types";

interface TimerDisplayProps extends SlotProps {
  duration?: number;
}

export function TimerDisplay({ ctx, duration = 30 }: TimerDisplayProps) {
  const [remaining, setRemaining] = useState(duration * 60);
  const [paused, setPaused] = useState(false);
  const hasEndedRef = useRef(false);
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;

  useEffect(() => {
    if (paused) return;
    if (remaining <= 0) {
      if (hasEndedRef.current) return;
      hasEndedRef.current = true;
      ctxRef.current.bus.emit("timer:timeout");
      ctxRef.current.endTraining();
      return;
    }
    const id = setInterval(() => setRemaining((r) => r - 1), 1000);
    return () => clearInterval(id);
  }, [remaining, paused]);

  const mins = Math.floor(remaining / 60);
  const secs = remaining % 60;

  return (
    <div className="flex items-center gap-1 text-sm font-mono tabular-nums">
      <span className={remaining < 300 ? "text-red-500" : ""}>
        {String(mins).padStart(2, "0")}:{String(secs).padStart(2, "0")}
      </span>
      <button onClick={() => setPaused((p) => !p)} className="text-xs text-muted-foreground">
        {paused ? "▶" : "⏸"}
      </button>
    </div>
  );
}
