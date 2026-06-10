import { useEffect, useState } from "react";
import type { EmotionState } from "@/engine/PluginContext";
import { EMOTION_LABELS, getEmotionColor, useEmotion } from "@/engine/PluginContext";
import type { PanelTabProps } from "@/engine/types";
import { cn } from "@/lib/utils";

const EMOTION_BG: Record<EmotionState, string> = {
  withdrawn: "bg-red-400",
  defensive: "bg-orange-400",
  neutral: "bg-muted",
  relaxed: "bg-blue-400",
  open: "bg-green-400",
};

const EMOTION_BORDER_BG: Record<EmotionState, string> = {
  withdrawn: "border-red-400 bg-red-50",
  defensive: "border-orange-400 bg-orange-50",
  neutral: "border-border bg-muted/30",
  relaxed: "border-blue-400 bg-blue-50",
  open: "border-green-400 bg-green-50",
};

export function EmotionTab({ ctx }: PanelTabProps) {
  const { emotion, setEmotion } = useEmotion();
  const [history, setHistory] = useState<Array<{ score: number; state: string; intent: string; timestamp: string }>>([]);

  useEffect(() => {
    const unsub1 = ctx.bus.on("emotion:changed", (data: { emotion: EmotionState }) => {
      setEmotion(data.emotion);
    });

    const fetchHistory = async () => {
      try {
        const res = await fetch(`/api/training/${ctx.recordId}/emotion/history`);
        const data = await res.json();
        if (data.history) setHistory(data.history);
      } catch {
        /* ignore */
      }
    };
    fetchHistory();

    return () => {
      unsub1();
    };
  }, [ctx.bus, ctx.recordId, setEmotion]);

  return (
    <div className="space-y-4">
      <div className={cn("text-center p-3 rounded-lg border", EMOTION_BORDER_BG[emotion])}>
        <div className={cn("inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-bold", getEmotionColor(emotion))}>
          <span className={cn("size-2.5 rounded-full", EMOTION_BG[emotion])} />
          {EMOTION_LABELS[emotion]}
        </div>
      </div>

      <div className="space-y-2">
        <h4 className="text-xs font-semibold text-muted-foreground">情绪变化时间线</h4>
        {history.length === 0 ? (
          <p className="text-xs text-muted-foreground">暂无情绪变化记录</p>
        ) : (
          <div className="space-y-1">
            {history
              .slice(-10)
              .reverse()
              .map((h, i) => (
                <div key={i} className="flex items-center gap-2 text-xs py-1">
                  <span className={cn("size-2 rounded-full shrink-0", EMOTION_BG[h.state as EmotionState] || "bg-muted")} />
                  <span className="text-muted-foreground">{EMOTION_LABELS[h.state as EmotionState] || h.state}</span>
                  <span className="text-muted-foreground/50 ml-auto">{h.intent}</span>
                </div>
              ))}
          </div>
        )}
      </div>
    </div>
  );
}
