/**
 * 结构化护理评估记录场景卡（NursingRecord）。
 * 读写后端 /api/nursing-records/{record_id} 端的 sheet_data（JSONB）。
 * 开启 nursing_record 能力时，评分引擎自动将 sheet_data 注入 LLM 打分 prompt。
 */
import { useMutation, useQuery } from "@tanstack/react-query";
import { FileText, Loader2, Save } from "lucide-react";
import { useCallback, useRef } from "react";
import type { SceneCardProps } from "@/engine/scene-card";
import { cn } from "@/utils/cn";

const API_BASE = "/api/nursing-records";

interface SheetData {
  subjective?: string;
  objective?: string;
  assessment?: string;
  plan?: string;
  evaluation?: string;
}

export default function NursingRecordCard({ recordId }: SceneCardProps) {
  const rid = Number(recordId);
  const initialRef = useRef<SheetData | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["nursing-record", rid],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/${rid}`);
      const d = await res.json();
      const sd: SheetData = d.sheet_data || {};
      initialRef.current = { ...sd };
      return { ...d, sheet_data: sd };
    },
  });

  const saveMutation = useMutation({
    mutationFn: async (sd: SheetData) => {
      await fetch(`${API_BASE}/${rid}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sheet_data: sd, status: "draft" }),
      });
    },
  });

  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const handleSave = useCallback(() => {
    if (!fieldRef.current) return;
    const form = fieldRef.current.closest("form") as HTMLFormElement | null;
    if (!form) return;
    const fd = new FormData(form);
    const sd: SheetData = {
      subjective: (fd.get("subjective") as string) || "",
      objective: (fd.get("objective") as string) || "",
      assessment: (fd.get("assessment") as string) || "",
      plan: (fd.get("plan") as string) || "",
      evaluation: (fd.get("evaluation") as string) || "",
    };
    saveMutation.mutate(sd);
  }, [saveMutation]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-32 text-muted-foreground">
        <Loader2 size={18} className="animate-spin mr-2" />
        <span className="text-xs">加载评估记录...</span>
      </div>
    );
  }

  const sd = data?.sheet_data || {};

  return (
    <form className="space-y-3 p-3" onSubmit={(e) => { e.preventDefault(); handleSave(); }}>
      {([
        ["subjective", "主观资料 (S)", "患者主诉、症状感受、病史...", "h-20"],
        ["objective", "客观资料 (O)", "生命体征、体格检查结果、实验室数据...", "h-20"],
        ["assessment", "评估 (A)", "护理诊断、风险评估、临床判断...", "h-20"],
        ["plan", "计划 (P)", "护理措施、预期目标、健康教育...", "h-20"],
        ["evaluation", "评价 (E)", "措施效果、病情变化、后续计划...", "h-20"],
      ] as const).map(([key, label, placeholder, height]) => (
        <div key={key}>
          <label className="text-[11px] font-medium text-muted-foreground mb-1 block">
            {label}
          </label>
          <textarea
            name={key}
            defaultValue={(sd as any)[key] || ""}
            placeholder={placeholder}
            className={cn(
              "w-full rounded-lg border border-border bg-background p-2 text-xs leading-relaxed resize-y",
              height,
            )}
          />
        </div>
      ))}

      <div className="flex items-center justify-between pt-1">
        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
          <FileText size={12} />
          <span>{saveMutation.isSuccess ? "已保存" : saveMutation.isPending ? "保存中..." : "护理评估记录"}</span>
        </div>
        <button
          type="submit"
          disabled={saveMutation.isPending}
          className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          <Save size={12} />
          {saveMutation.isPending ? "保存中..." : "保存"}
        </button>
      </div>
    </form>
  );
}
