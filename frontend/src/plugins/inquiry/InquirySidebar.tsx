import { useEffect, useMemo, useState } from "react";
import type { SlotProps } from "@/engine/types";

export function InquirySidebar({ ctx }: SlotProps) {
  const [completed, setCompleted] = useState<Set<string>>(new Set());
  const inquiries = ctx.patient.requiredInquiries ?? [];

  useEffect(() => {
    const unsub = ctx.bus.on("stream:done", () => {
      const msgs = document.querySelectorAll("[data-role='patient']");
      msgs.forEach((el) => {
        const text = (el.textContent ?? "").toLowerCase();
        for (const q of inquiries) {
          if (text.includes(q.toLowerCase())) {
            setCompleted((prev) => new Set([...prev, q]));
          }
        }
      });
    });
    return unsub;
  }, [inquiries, ctx.bus]);

  if (inquiries.length === 0) return null;

  const done = completed.size;
  const total = inquiries.length;
  const pct = Math.round((done / total) * 100);

  return (
    <div className="text-xs">
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground">{/* 问诊进度 */}</span>
        <div className="h-1.5 flex-1 rounded-full bg-muted">
          <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
        </div>
        <span className="tabular-nums text-muted-foreground">
          {done}/{total}
        </span>
      </div>
    </div>
  );
}
