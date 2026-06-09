import { ChevronDown, ChevronRight, ClipboardList, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import Sheet from "@/components/ui/Sheet";
import { cn } from "@/lib/utils";
import { NURSING_RECORD_SHEET_CONFIG } from "./config";
import { ITEM_COMPONENTS } from "./index";
import type { RecordSheetSection } from "./types";

interface NursingRecordPanelProps {
  isOpen: boolean;
  onToggle: () => void;
  recordId: string;
}

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

function getInitialValues(recordId: string) {
  return loadValues(recordId);
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

export default function NursingRecordPanel({ isOpen, onToggle, recordId }: NursingRecordPanelProps) {
  const [values, setValues] = useState<Record<string, Record<string, unknown>>>(() => getInitialValues(recordId));
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());

  useEffect(() => {
    setValues(getInitialValues(recordId));
    setCollapsedSections(new Set());
  }, [recordId]);

  useEffect(() => {
    saveValues(recordId, values);
  }, [values, recordId]);

  const updateValue = (sectionKey: string, itemKey: string, value: unknown) => {
    setValues((prev) => {
      const next = { ...prev };
      if (!next[sectionKey]) {
        next[sectionKey] = {};
      }
      next[sectionKey] = { ...next[sectionKey], [itemKey]: value } as Record<string, unknown>;
      return next;
    });
  };

  const toggleSection = (key: string) => {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const sectionValues = values;

  const filledCount = useMemo(() => {
    let count = 0;
    for (const section of NURSING_RECORD_SHEET_CONFIG.sections) {
      for (const item of section.items) {
        const sectionVal = sectionValues[section.key];
        if (!sectionVal) continue;
        const val: unknown = sectionVal[item.key];
        if (val === undefined || val === null) continue;
        if (typeof val === "string" && (val as string).trim().length > 0) {
          count++;
        } else if (typeof val === "object" && Object.keys(val as object).length > 0) {
          count++;
        }
      }
    }
    return count;
  }, [sectionValues]);

  const totalItems = useMemo(() => {
    return NURSING_RECORD_SHEET_CONFIG.sections.reduce((sum, s) => sum + s.items.length, 0);
  }, []);

  return (
    <>
      <button
        className="relative flex items-center gap-1 px-2 h-8 rounded-md border border-border bg-card text-xs sm:text-sm font-medium text-muted-foreground transition-colors hover:text-foreground hover:border-primary/50 shrink-0"
        onClick={onToggle}
        title="护理问诊记录单"
        aria-label="护理问诊记录单"
      >
        <ClipboardList size={13} className="sm:size-[16px]" />
        <span className="hidden sm:inline">记录单</span>
        {filledCount > 0 && (
          <span className="text-[0.6rem] text-muted-foreground/60">
            {filledCount}/{totalItems}
          </span>
        )}
      </button>

      <Sheet open={isOpen} onClose={onToggle} side="right" size="md">
        <div className="flex justify-between items-center px-5 py-3.5 border-b border-border shrink-0">
          <div>
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <ClipboardList size={16} />
              {NURSING_RECORD_SHEET_CONFIG.title}
            </h3>
            <p className="text-[0.65rem] text-muted-foreground mt-0.5">
              已填写 {filledCount}/{totalItems} 项
            </p>
          </div>
          <button
            onClick={onToggle}
            className="w-8 h-8 rounded-lg border border-border bg-card flex items-center justify-center hover:bg-muted transition-colors shrink-0"
            aria-label="关闭记录单"
          >
            <X size={14} />
          </button>
        </div>

        <div className="px-4 py-3 space-y-1">
          {NURSING_RECORD_SHEET_CONFIG.sections.map((section) => {
            const isCollapsed = collapsedSections.has(section.key);
            return (
              <div
                key={section.key}
                className={cn("rounded-lg border transition-colors", !isCollapsed && "border-border bg-card", isCollapsed && "border-transparent")}
              >
                <div className={cn("px-3", !isCollapsed && "border-b border-border/40")}>
                  <SectionHeader section={section} isOpen={!isCollapsed} onToggle={() => toggleSection(section.key)} />
                </div>
                {!isCollapsed && (
                  <div className="px-3 py-2.5 space-y-2.5">
                    {section.items.map((item) => {
                      const Component = ITEM_COMPONENTS[item.type];
                      if (!Component) return null;
                      const sectionVal = sectionValues[section.key];
                      const itemVal = sectionVal?.[item.key];
                      return (
                        <div key={item.key}>
                          <Component
                            item={item}
                            value={itemVal !== undefined ? itemVal : ""}
                            onChange={(v: unknown) => updateValue(section.key, item.key, v)}
                          />
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="px-5 py-3 border-t border-border text-xs text-muted-foreground leading-relaxed shrink-0 text-center">
          提示：本记录单为模拟HIS系统填写，数据仅保存在本地浏览器
        </div>
      </Sheet>
    </>
  );
}
