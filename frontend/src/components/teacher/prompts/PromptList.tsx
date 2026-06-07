import { CheckCircle, ChevronDown, ChevronRight, Layers, Plus, Trash2 } from "lucide-react";
import Button from "@/components/ui/Button";
import EmptyState from "@/components/ui/EmptyState";
import { cn } from "@/lib/utils";
import type { PromptTemplateResponse } from "./types";
import { PURPOSE_LABELS, PURPOSES } from "./types";

interface PromptListProps {
  grouped: Record<string, PromptTemplateResponse[]>;
  expanded: Record<string, boolean>;
  editing: number | "new" | null;
  prompts: PromptTemplateResponse[];
  formPurpose: string;
  onToggle: (purpose: string) => void;
  onOpenNew: (purpose: string) => void;
  onOpenEdit: (p: PromptTemplateResponse) => void;
  onActivate: (p: PromptTemplateResponse) => void;
  onDelete: (p: PromptTemplateResponse) => void;
}

export default function PromptList({
  grouped,
  expanded,
  editing,
  prompts,
  formPurpose,
  onToggle,
  onOpenNew,
  onOpenEdit,
  onActivate,
  onDelete,
}: PromptListProps) {
  return (
    <>
      <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden max-[900px]:hidden">
        {PURPOSES.map((purpose) => {
          const versions = grouped[purpose] || [];
          const isOpen = expanded[purpose] !== false;
          return (
            <div key={purpose} className="border-b border-border last:border-b-0">
              <div
                onClick={() => onToggle(purpose)}
                className="flex items-center gap-2 px-4 py-3 cursor-pointer select-none font-semibold text-sm bg-muted text-foreground"
              >
                {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                <span className="flex-1">{PURPOSE_LABELS[purpose]}</span>
                <span className="text-xs text-muted-foreground/70 font-normal">{versions.length}个版本</span>
                <Button
                  variant="outline"
                  size="xs"
                  className="bg-blue-50 border-blue-200 text-blue-600"
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpenNew(purpose);
                  }}
                  title="新增"
                >
                  <Plus size={13} /> 新增
                </Button>
              </div>
              {isOpen && (
                <div>
                  {versions.length === 0 ? (
                    <EmptyState icon={Layers} title="暂无模板" className="py-3" />
                  ) : (
                    versions.map((v) => (
                      <div
                        key={v.id}
                        onClick={() => onOpenEdit(v)}
                        onDoubleClick={(e) => {
                          e.preventDefault();
                          if (!v.is_active) onActivate(v);
                        }}
                        className={cn(
                          "flex items-center gap-2 px-4 py-2 border-t border-border cursor-pointer transition-colors",
                          v.locked ? "bg-amber-50/50 hover:bg-amber-100/50" : editing === v.id ? "bg-blue-50" : v.is_active ? "bg-green-50" : "bg-transparent",
                        )}
                      >
                        {v.locked ? (
                          <span className="text-xs font-bold px-1.5 py-0.5 rounded-sm bg-amber-100 border border-amber-200 min-w-[36px] text-center text-amber-700">
                            内置
                          </span>
                        ) : (
                          <span className="text-xs font-bold px-1.5 py-0.5 rounded-sm bg-card border border-border min-w-[28px] text-center">v{v.version}</span>
                        )}
                        <span className="flex-1 text-sm overflow-hidden text-ellipsis whitespace-nowrap">{v.name || "-"}</span>
                        {v.is_active ? (
                          <span className="text-xs px-1.5 rounded-full bg-green-100 text-green-700 whitespace-nowrap inline-flex items-center gap-0.5">
                            <CheckCircle size={10} /> {v.locked ? "内置生效" : "激活"}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground/70">未激活</span>
                        )}
                        <div onClick={(e) => e.stopPropagation()} className="flex gap-0.5">
                          {v.locked ? (
                            <span className="text-xs text-muted-foreground/50 p-0.5" title="内置提示词不可删除">
                              🔒
                            </span>
                          ) : (
                            <Button variant="ghost" size="sm" className="text-destructive p-0.5" onClick={() => onDelete(v)} title="删除">
                              <Trash2 size={13} />
                            </Button>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="max-[900px]:block hidden mb-3">
        <select
          value={editing !== "new" && editing != null ? prompts.find((p) => p.id === editing)?.purpose || "" : editing === "new" ? formPurpose : ""}
          onChange={(e) => {
            const p = prompts.find((pt) => pt.id === Number(e.target.value));
            if (p) onOpenEdit(p);
            else if (e.target.value) onOpenNew(e.target.value);
          }}
          className="w-full py-2 px-3 border border-border rounded-lg text-sm bg-card"
        >
          <option value="">选择模板编辑...</option>
          {PURPOSES.map((purpose) => (
            <optgroup key={purpose} label={PURPOSE_LABELS[purpose]}>
              {(grouped[purpose] || []).map((v) => (
                <option key={v.id} value={v.id}>
                  v{v.version} {v.name || PURPOSE_LABELS[purpose]}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>

      {editing == null && (
        <div className="rounded-xl border border-border bg-card shadow-sm p-8 flex flex-col items-center justify-center min-h-[300px]">
          <Layers size={40} className="text-muted-foreground/70 opacity-50 mb-4" />
          <div className="text-base font-semibold text-muted-foreground mb-1">选择左侧版本进行编辑</div>
          <div className="text-sm text-muted-foreground/70 mb-4">
            点击版本名打开编辑器，或点击左侧 <Plus size={12} className="inline align-middle text-primary" /> 为场景创建新版本
          </div>
          {!prompts.length && (
            <Button onClick={() => onOpenNew("patient_chat")}>
              <Plus size={14} /> 创建第一个版本
            </Button>
          )}
        </div>
      )}
    </>
  );
}
