import { ChevronDown, ChevronRight } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { PanelTabProps } from "@/engine/types";
import { cn } from "@/lib/utils";
import { NURSING_RECORD_SHEET_CONFIG } from "./config";
import { ITEM_COMPONENTS } from "./index";
import type { RecordSheetSection } from "./types";

const STORAGE_PREFIX = "nursing_record_sheet_";

function loadValues(recordId: string): Record<string, Record<string, unknown>> {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + recordId);
    if (raw) return JSON.parse(raw);
  } catch {
    /* ignore */
  }
  return {};
}

function saveValues(recordId: string, values: Record<string, Record<string, unknown>>) {
  try {
    localStorage.setItem(STORAGE_PREFIX + recordId, JSON.stringify(values));
  } catch {
    /* ignore */
  }
}

function SectionHeader({ section, isOpen, onToggle }: { section: RecordSheetSection; isOpen: boolean; onToggle: () => void }) {
  if (!section.collapsible) {
    return <h4 className="text-xs font-semibold text-foreground/80 px-1 py-1.5">{section.label}</h4>;
  }
  return (
    <button type="button" onClick={onToggle} className="flex items-center gap-1.5 w-full text-left px-1 py-1.5 hover:text-foreground transition-colors">
      {isOpen ? <ChevronDown size={14} className="text-muted-foreground shrink-0" /> : <ChevronRight size={14} className="text-muted-foreground shrink-0" />}
      <h4 className="text-xs font-semibold text-foreground/80">{section.label}</h4>
    </button>
  );
}

export function NursingRecordPanel({ ctx }: PanelTabProps) {
  const recordId = ctx.recordId;
  const [values, setValues] = useState<Record<string, Record<string, unknown>>>(() => loadValues(recordId));
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());

  useEffect(() => {
    setValues(loadValues(recordId));
    setCollapsedSections(new Set());
  }, [recordId]);

  useEffect(() => {
    saveValues(recordId, values);
  }, [values, recordId]);

  const updateValue = (sectionKey: string, itemKey: string, value: unknown) => {
    setValues((prev) => {
      const next = { ...prev };
      if (!next[sectionKey]) next[sectionKey] = {};
      next[sectionKey] = { ...next[sectionKey], [itemKey]: value } as Record<string, unknown>;
      return next;
    });
  };

  const toggleSection = (key: string) => {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const filledCount = useMemo(() => {
    let count = 0;
    for (const section of NURSING_RECORD_SHEET_CONFIG.sections) {
      for (const item of section.items) {
        const sectionVal = values[section.key];
        if (!sectionVal) continue;
        const val = sectionVal[item.key];
        if (val === undefined || val === null) continue;
        if (typeof val === "string" && (val as string).trim().length > 0) count++;
        else if (typeof val === "object" && Object.keys(val as object).length > 0) count++;
      }
    }
    return count;
  }, [values]);

  const totalItems = useMemo(() => NURSING_RECORD_SHEET_CONFIG.sections.reduce((sum, s) => sum + s.items.length, 0), []);

  return (
    <div className="space-y-2">
      <p className="text-[0.65rem] text-muted-foreground">
        已填写 {filledCount}/{totalItems} 项
      </p>
      <div className="space-y-1">
        {NURSING_RECORD_SHEET_CONFIG.sections.map((section) => {
          const isCollapsed = collapsedSections.has(section.key);
          return (
            <div
              key={section.key}
              className={cn("rounded-lg border transition-colors", !isCollapsed && "border-border bg-card", isCollapsed && "border-transparent")}
            >
              <div className={cn("px-2", !isCollapsed && "border-b border-border/40")}>
                <SectionHeader section={section} isOpen={!isCollapsed} onToggle={() => toggleSection(section.key)} />
              </div>
              {!isCollapsed && (
                <div className="px-2 py-2 space-y-2">
                  {section.items.map((item) => {
                    const Component = ITEM_COMPONENTS[item.type];
                    if (!Component) return null;
                    const sectionVal = values[section.key];
                    const itemVal = sectionVal?.[item.key];
                    return (
                      <div key={item.key}>
                        <Component item={item} value={itemVal !== undefined ? itemVal : ""} onChange={(v: unknown) => updateValue(section.key, item.key, v)} />
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <p className="text-[0.6rem] text-muted-foreground text-center pt-2">数据保存在本地浏览器</p>
    </div>
  );
}
