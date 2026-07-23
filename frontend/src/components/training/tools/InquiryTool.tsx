import { CheckCircle2, Circle } from "lucide-react";
import { useMemo } from "react";
import type { TrainingToolProps } from "@/engine/TrainingTool";
import { useTrainingContext } from "@/engine/TrainingContext";
import type { ChatMessage } from "@/engine/types";

export default function InquiryTool(props: TrainingToolProps) {
  const { messages } = useTrainingContext();

  const inquiries: string[] = useMemo(() => {
    const cd = (props.recordDetail?.case_data as Record<string, unknown>) ?? {};
    return (cd.required_inquiries as string[]) ?? [];
  }, [props.recordDetail]);

  const coveredKeywords = useMemo(() => {
    const studentTexts = (messages as ChatMessage[])
      .filter((m) => m.role === "student")
      .map((m) => String(m.content || ""))
      .join(" ");
    return new Set(
      inquiries.filter((inq) => {
        const keywords = inq.split(/[（(]/)[0].split(/[,，、]/);
        return keywords.some((kw) => studentTexts.includes(kw.trim()));
      }),
    );
  }, [messages, inquiries]);

  if (inquiries.length === 0) {
    return <div className="text-sm text-muted-foreground text-center py-8 p-3">该病例未配置问诊清单</div>;
  }

  const doneCount = coveredKeywords.size;

  return (
    <div className="space-y-1 p-3">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs text-muted-foreground">问诊目标 ({doneCount}/{inquiries.length})</span>
        {doneCount > 0 && (
          <span className="text-[10px] text-success-foreground bg-success px-1.5 py-0.5 rounded">
            {Math.round((doneCount / inquiries.length) * 100)}%
          </span>
        )}
      </div>
      {inquiries.map((inq, i) => {
        const done = coveredKeywords.has(inq);
        return (
          <div key={i} className={`flex items-start gap-2 py-1.5 ${done ? "opacity-60" : ""}`}>
            {done
              ? <CheckCircle2 size={14} className="text-success-foreground mt-0.5 shrink-0" />
              : <Circle size={14} className="text-muted-foreground/30 mt-0.5 shrink-0" />
            }
            <span className={`text-sm ${done ? "line-through text-muted-foreground" : ""}`}>{inq}</span>
          </div>
        );
      })}
    </div>
  );
}
