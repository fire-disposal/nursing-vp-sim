import { CheckCircle2, Circle, ListChecks, X } from "lucide-react";
import { useMemo, useState } from "react";
import Sheet from "@/components/ui/Sheet";
import { cn } from "@/lib/utils";
import type { ChatMessage } from "@/types/chat";

export function extractKeywords(inquiry: string): string[] {
  const cleaned = inquiry.replace(/[（）()]/g, " ");
  const tokens: string[] = [];
  for (let i = 0; i < cleaned.length - 1; i++) {
    tokens.push(cleaned.slice(i, i + 2));
  }
  return [...new Set(tokens.filter((t) => t.trim().length === 2))];
}

export function getInquiryLabel(inquiry: string): string {
  return inquiry
    .replace(/（[^）]*）/g, "")
    .replace(/\([^)]*\)/g, "")
    .slice(0, 18);
}

interface InquirySidebarProps {
  inquiries: string[];
  studentMessages: ChatMessage[];
}

export default function InquirySidebar({ inquiries, studentMessages }: InquirySidebarProps) {
  const [isOpen, setIsOpen] = useState(false);

  const addressed = useMemo(() => {
    if (!inquiries || inquiries.length === 0) return new Set<number>();
    const allText = studentMessages.map((m) => m.content).join("");
    const result = new Set<number>();
    inquiries.forEach((inquiry, idx) => {
      const keywords = extractKeywords(inquiry);
      const matched = keywords.some((kw) => allText.includes(kw));
      if (matched) result.add(idx);
    });
    return result;
  }, [inquiries, studentMessages]);

  const covered = addressed.size;
  const total = inquiries.length;
  const pct = total > 0 ? Math.round((covered / total) * 100) : 0;

  const onToggle = () => setIsOpen((v) => !v);

  return (
    <>
      <button
        className="relative flex items-center gap-1 px-2 h-8 rounded-md border border-border bg-card text-xs sm:text-sm font-medium text-muted-foreground transition-colors hover:text-foreground hover:border-primary/50 shrink-0"
        onClick={onToggle}
        title="采集进度"
        aria-label="采集进度"
      >
        <ListChecks size={13} className="sm:size-[16px]" />
        <span>
          {covered}/{total}
        </span>
        {pct < 100 && <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-amber-500" />}
      </button>

      <Sheet open={isOpen} onClose={() => setIsOpen(false)} side="right" size="md">
        <div className="flex justify-between items-center px-5 py-4 border-b border-border">
          <h3 className="text-base font-semibold flex items-center gap-2">
            <ListChecks size={18} /> 采集进度
          </h3>
          <button
            onClick={onToggle}
            className="w-8 h-8 rounded-lg border border-border bg-card flex items-center justify-center hover:bg-muted transition-colors"
            aria-label="关闭进度面板"
          >
            <X size={14} />
          </button>
        </div>

        <div className="px-5 py-4 border-b border-border">
          <div className="flex justify-between mb-2">
            <span className="text-xs text-muted-foreground">关键问诊内容覆盖</span>
            <span className={cn("text-sm font-bold", pct >= 80 ? "text-green-600" : pct >= 40 ? "text-amber-600" : "text-red-600")}>
              {covered}/{total}
            </span>
          </div>
          <div className="h-1.5 rounded-full bg-muted overflow-hidden">
            <div
              className={cn("h-full rounded-full transition-[width] duration-500", pct >= 80 ? "bg-green-500" : pct >= 40 ? "bg-amber-500" : "bg-red-500")}
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>

        <div className="flex-1 overflow-auto py-2">
          {inquiries.map((inquiry, idx) => {
            const done = addressed.has(idx);
            return (
              <div
                key={idx}
                className={cn("flex items-start gap-2.5 px-5 py-2.5 text-sm transition-colors", done ? "text-foreground" : "text-muted-foreground/60")}
              >
                {done ? (
                  <CheckCircle2 size={16} className="text-green-500 shrink-0 mt-0.5" />
                ) : (
                  <Circle size={16} className="text-muted-foreground/30 shrink-0 mt-0.5" />
                )}
                <span className="leading-relaxed">{getInquiryLabel(inquiry)}</span>
              </div>
            );
          })}
        </div>

        <div className="px-5 py-3 border-t border-border text-xs text-muted-foreground leading-relaxed">
          提示：系统根据对话关键词自动匹配，仅供参考。建议按护理评估框架全面采集病史。
        </div>
      </Sheet>
    </>
  );
}
