import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, Loader2, Save } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { getNursingRecord, saveNursingRecord } from "@/api/training";
import { useToast } from "@/components/Toast";
import type { SceneCardProps } from "@/engine/scene-card";
import { cn } from "@/utils/cn";

interface SheetData {
  subjective?: string;
  objective?: string;
  assessment?: string;
  plan?: string;
  evaluation?: string;
}

const FIELDS = [
  ["subjective", "主观资料 (S)", "患者主诉、症状感受、病史...", "h-14 sm:h-20"],
  ["objective", "客观资料 (O)", "生命体征、体格检查结果、实验室数据...", "h-14 sm:h-20"],
  ["assessment", "评估 (A)", "护理诊断、风险评估、临床判断...", "h-14 sm:h-20"],
  ["plan", "计划 (P)", "护理措施、预期目标、健康教育...", "h-14 sm:h-20"],
  ["evaluation", "评价 (E)", "措施效果、病情变化、后续计划...", "h-14 sm:h-20"],
] as const;

export default function NursingRecordCard({ recordId, bus }: SceneCardProps) {
  const rid = Number(recordId);
  const [sheet, setSheet] = useState<SheetData>({});
  const dirtyRef = useRef(false);
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const toast = useToast();

  const { isLoading } = useQuery({
    queryKey: ["nursing-record", rid],
    queryFn: async () => {
      const { data: d } = await getNursingRecord(rid);
      const sd: SheetData = (d as { sheet_data?: SheetData }).sheet_data || {};
      setSheet((prev) => {
        if (dirtyRef.current) return prev;
        if (Object.keys(prev).length > 0) return prev;
        return sd;
      });
      return d;
    },
  });

  const saveMutation = useMutation({
    mutationFn: async (sd: SheetData) => {
      await saveNursingRecord(rid, { sheet_data: sd as Record<string, unknown>, status: "draft" });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["nursing-record", rid] });
    },
    onError: () => {
      toast.error("保存失败，请重试");
    },
  });

  const doAutoSave = useCallback(
    async (sd: SheetData) => {
      setSaveStatus("saving");
      try {
        await saveNursingRecord(rid, { sheet_data: sd as Record<string, unknown>, status: "draft" });
        setSaveStatus("saved");
        setLastSavedAt(
          new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }),
        );
      } catch {
        setSaveStatus("error");
      }
    },
    [rid],
  );

  const handleSave = useCallback(() => {
    saveMutation.mutate(sheet);
  }, [saveMutation, sheet]);

  const update = (key: string, value: string) => {
    dirtyRef.current = true;
    setSheet((prev) => ({ ...prev, [key]: value }));
  };

  useEffect(() => {
    if (!dirtyRef.current) return;
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = setTimeout(() => {
      doAutoSave(sheet);
    }, 3000);
    return () => {
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    };
  }, [sheet, doAutoSave]);

  useEffect(() => {
    if (!bus) return;
    const handler = () => {
      if (dirtyRef.current) {
        if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
        doAutoSave(sheet);
      }
    };
    return bus.on("training:beforeEnd", handler);
  }, [bus, sheet, doAutoSave]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-32 text-muted-foreground">
        <Loader2 size={18} className="animate-spin mr-2" />
        <span className="text-xs">加载评估记录...</span>
      </div>
    );
  }

  return (
    <form className="space-y-3 p-3" onSubmit={(e) => { e.preventDefault(); handleSave(); }}>
      {FIELDS.map(([key, label, placeholder, height]) => (
        <div key={key}>
          <label className="text-[11px] font-medium text-muted-foreground mb-1 block">
            {label}
          </label>
          <textarea
            value={sheet[key] || ""}
            onChange={(e) => update(key, e.target.value)}
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
          <span>
            {saveStatus === "saving"
              ? "保存中..."
              : saveStatus === "saved"
                ? `已自动保存 ${lastSavedAt || ""}`
                : saveStatus === "error"
                  ? "保存失败"
                  : "护理评估记录"}
          </span>
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
