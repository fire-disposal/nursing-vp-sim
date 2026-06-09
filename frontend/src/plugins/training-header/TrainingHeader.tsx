import { ArrowLeft, Clock, Ear, EarOff, Phone } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { SlotProps } from "@/engine/types";
import { cn } from "@/lib/utils";
import { getPatientAvatar } from "@/utils/avatar";

function formatTime(sec: number | null): string {
  if (sec === null || sec <= 0) return "00:00";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function TrainingHeader({ ctx }: SlotProps) {
  const navigate = useNavigate();
  const { patient, messages, tts, endTraining, bus } = ctx;
  const [ending, setEnding] = useState(false);

  const hasEndedRef = useRef(false);
  const [remaining, setRemaining] = useState(30 * 60);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (paused) return;
    if (remaining <= 0) {
      if (hasEndedRef.current) return;
      hasEndedRef.current = true;
      bus.emit("timer:timeout");
      handleEnd();
      return;
    }
    const id = setInterval(() => setRemaining((r) => r - 1), 1000);
    return () => clearInterval(id);
  }, [remaining, paused]);

  const handleBack = useCallback(() => navigate("/cases"), [navigate]);

  const handleEnd = useCallback(async () => {
    if (ending || hasEndedRef.current) return;
    setEnding(true);
    try {
      await endTraining();
    } finally {
      setEnding(false);
    }
  }, [ending, endTraining]);

  return (
    <header className="shrink-0 border-b border-border bg-card px-2 py-1 sm:px-4 sm:py-0 sm:h-14" style={{ paddingTop: "max(env(safe-area-inset-top), 8px)" }}>
      <div className="flex items-center gap-2 h-full">
        <button
          className="w-10 h-10 sm:w-9 sm:h-9 rounded-lg border border-border bg-card text-muted-foreground flex items-center justify-center shrink-0 hover:bg-muted hover:text-foreground transition-colors"
          onClick={handleBack}
          title="返回病例选择"
          aria-label="返回病例选择"
        >
          <ArrowLeft size={16} className="sm:size-[18px]" />
        </button>

        {patient && (
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <img
              className="w-7 h-7 sm:w-9 sm:h-9 rounded-full object-cover shrink-0 bg-muted ring-2 ring-border"
              src={getPatientAvatar({ name: patient.name, gender: patient.gender })}
              alt={patient.name}
            />
            <div className="min-w-0">
              <div className="text-xs sm:text-sm font-semibold text-foreground truncate">{patient.name}</div>
              <div className="text-[0.65rem] sm:text-xs text-muted-foreground truncate">{patient.caseTitle}</div>
            </div>
          </div>
        )}

        <div
          className={cn(
            "flex items-center gap-1 px-2 py-1 rounded-md text-xs sm:text-sm font-bold tabular-nums border bg-card shrink-0",
            remaining <= 120 && "border-red-200 bg-red-50 text-red-600",
            remaining > 120 && remaining <= 300 && "border-amber-200 bg-amber-50 text-amber-600",
            remaining > 300 && "border-border text-muted-foreground",
          )}
        >
          <Clock size={12} className="sm:size-[14px] shrink-0" />
          <span>{formatTime(remaining)}</span>
          <button onClick={() => setPaused((p) => !p)} className="text-xs text-muted-foreground ml-0.5">
            {paused ? "▶" : "⏸"}
          </button>
        </div>

        <div className="flex items-center gap-1">
          <button
            className={cn(
              "w-10 h-10 sm:w-9 sm:h-9 rounded-lg border border-border bg-card text-muted-foreground flex items-center justify-center shrink-0 transition-colors hover:bg-muted",
              tts.isAutoPlay && "border-primary bg-primary/10 text-primary hover:bg-primary/20",
            )}
            onClick={() => tts.setAutoPlay(!tts.isAutoPlay)}
            title={tts.isAutoPlay ? "关闭自动朗读" : "开启自动朗读"}
            aria-label={tts.isAutoPlay ? "关闭自动朗读" : "开启自动朗读"}
          >
            {tts.isAutoPlay ? <Ear size={14} className="sm:size-[16px]" /> : <EarOff size={14} className="sm:size-[16px]" />}
          </button>

          <button
            className="flex items-center gap-1 px-2.5 h-10 sm:h-9 rounded-md border border-destructive/30 bg-card text-destructive text-xs sm:text-sm font-medium shrink-0 hover:bg-destructive/10 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            onClick={handleEnd}
            disabled={ending || messages.length <= 1}
            aria-label="结束训练"
          >
            <Phone size={13} className="sm:size-[15px] sm:block hidden" />
            <span className="sm:block hidden">{ending ? "评分中..." : "结束训练"}</span>
            <span className="sm:hidden">{ending ? "..." : "结束"}</span>
          </button>
        </div>
      </div>
    </header>
  );
}
