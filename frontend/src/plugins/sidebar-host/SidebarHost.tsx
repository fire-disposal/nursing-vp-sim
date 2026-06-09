import { Activity, CheckCircle2, Circle, ClipboardList, ListChecks, Stethoscope, User, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { extractKeywords } from "@/components/training/InquirySidebar";
import type { SlotProps } from "@/engine/types";
import { cn } from "@/lib/utils";
import { ITEM_COMPONENTS } from "@/plugins/nursing-record";
import { NURSING_RECORD_SHEET_CONFIG } from "@/plugins/nursing-record/config";
import type { RecordSheetSection } from "@/plugins/nursing-record/types";

const EXAM_COMMANDS = [
  { id: "vitals", label: "生命体征", cmd: "测生命体征" },
  { id: "bp", label: "血压", cmd: "测血压" },
  { id: "temp", label: "体温", cmd: "测体温" },
  { id: "spo2", label: "血氧", cmd: "测血氧" },
  { id: "hr", label: "心率", cmd: "测心率" },
  { id: "rr", label: "呼吸", cmd: "测呼吸" },
  { id: "skin", label: "皮肤", cmd: "观察皮肤" },
  { id: "pain", label: "疼痛评分", cmd: "疼痛评分" },
];

type TabId = "inquiry" | "patient" | "exam" | "nursing";

const TAB_DEFS: { id: TabId; icon: typeof ListChecks; label: string; featureFlag?: string }[] = [
  { id: "inquiry", icon: ListChecks, label: "问诊进度" },
  { id: "patient", icon: User, label: "患者情况" },
  { id: "exam", icon: Stethoscope, label: "护理查体", featureFlag: "physical_exam" },
  { id: "nursing", icon: ClipboardList, label: "护理记录" },
];

const STORAGE_PREFIX = "nursing_record_sheet_";

function loadNursingValues(recordId: string): Record<string, Record<string, unknown>> {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + recordId);
    if (raw) return JSON.parse(raw);
  } catch {
    /* ignore */
  }
  return {};
}

function saveNursingValues(recordId: string, values: Record<string, Record<string, unknown>>) {
  try {
    localStorage.setItem(STORAGE_PREFIX + recordId, JSON.stringify(values));
  } catch {
    /* ignore */
  }
}

function InquiryTab({ ctx }: { ctx: SlotProps["ctx"] }) {
  const inquiries = ctx.patient?.requiredInquiries ?? [];
  const studentMessages = useMemo(() => ctx.messages.filter((m) => m.role === "student"), [ctx.messages]);

  const states = useMemo(
    () =>
      inquiries.map((inquiry) => {
        const keywords = extractKeywords(inquiry);
        const done = studentMessages.some((m) => keywords.some((kw) => (m.content ?? "").toLowerCase().includes(kw)));
        return { inquiry, done };
      }),
    [inquiries, studentMessages],
  );

  const doneCount = states.filter((s) => s.done).length;

  if (inquiries.length === 0) {
    return <p className="text-xs text-muted-foreground p-2">暂无问诊要求</p>;
  }

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between px-1 mb-2">
        <span className="text-xs font-semibold text-muted-foreground">完成进度</span>
        <span className="text-xs tabular-nums font-medium">
          {doneCount}/{inquiries.length}
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
        <div
          className="h-full rounded-full bg-primary transition-all duration-500"
          style={{ width: `${inquiries.length > 0 ? (doneCount / inquiries.length) * 100 : 0}%` }}
        />
      </div>
      <div className="space-y-0.5 pt-2">
        {states.map(({ inquiry, done }) => (
          <div
            key={inquiry}
            className={cn(
              "flex items-center gap-2 px-2 py-1.5 rounded-md text-xs transition-colors",
              done ? "bg-green-50 text-green-700" : "text-muted-foreground",
            )}
          >
            {done ? <CheckCircle2 size={14} className="text-green-500 shrink-0" /> : <Circle size={14} className="shrink-0" />}
            {inquiry}
          </div>
        ))}
      </div>
    </div>
  );
}

function PatientTab({ ctx }: { ctx: SlotProps["ctx"] }) {
  const p = ctx.patient;
  if (!p) return null;

  return (
    <div className="space-y-4">
      <div className="text-center">
        <div className="text-sm font-semibold">{p.name}</div>
        <div className="text-xs text-muted-foreground">{[p.gender === "male" ? "男" : "女", p.age ? `${p.age}岁` : ""].filter(Boolean).join(" · ")}</div>
      </div>

      <div className="space-y-3">
        <div className="rounded-lg border bg-muted/30 p-3">
          <div className="text-[0.65rem] font-semibold text-muted-foreground uppercase tracking-wider mb-1">主诉</div>
          <p className="text-xs leading-relaxed">{p.chiefComplaint || "未提供"}</p>
        </div>
        <div className="rounded-lg border bg-muted/30 p-3">
          <div className="text-[0.65rem] font-semibold text-muted-foreground uppercase tracking-wider mb-1">性格特征</div>
          <p className="text-xs leading-relaxed">{p.personality || "未提供"}</p>
        </div>
        <div className="rounded-lg border bg-muted/30 p-3">
          <div className="text-[0.65rem] font-semibold text-muted-foreground uppercase tracking-wider mb-1">病案</div>
          <p className="text-xs leading-relaxed">{p.caseTitle || "未提供"}</p>
        </div>
      </div>
    </div>
  );
}

function ExamTab({ ctx }: { ctx: SlotProps["ctx"] }) {
  return (
    <div className="grid grid-cols-2 gap-1.5">
      {EXAM_COMMANDS.map((op) => (
        <button
          key={op.id}
          onClick={() => ctx.sendMessage(op.cmd)}
          disabled={ctx.loading}
          className="rounded-lg border bg-card px-2.5 py-2 text-xs font-medium hover:bg-muted transition-colors disabled:opacity-50 text-left flex items-center gap-1.5"
        >
          <Activity size={13} className="text-muted-foreground shrink-0" />
          {op.label}
        </button>
      ))}
    </div>
  );
}

function NursingTab({ ctx }: { ctx: SlotProps["ctx"] }) {
  const recordId = ctx.recordId;
  const [values, setValues] = useState<Record<string, Record<string, unknown>>>(() => loadNursingValues(recordId));

  useEffect(() => {
    setValues(loadNursingValues(recordId));
  }, [recordId]);

  const updateValue = (sectionKey: string, itemKey: string, value: unknown) => {
    setValues((prev) => {
      const next = { ...prev };
      if (!next[sectionKey]) next[sectionKey] = {};
      next[sectionKey] = { ...next[sectionKey], [itemKey]: value } as Record<string, unknown>;
      saveNursingValues(recordId, next);
      return next;
    });
  };

  const getValue = (sectionKey: string, itemKey: string, fallback: unknown = "") => {
    return values[sectionKey]?.[itemKey] ?? fallback;
  };

  return (
    <div className="space-y-3">
      {NURSING_RECORD_SHEET_CONFIG.sections.map((section: RecordSheetSection) => (
        <div key={section.key} className="rounded-lg border bg-muted/30 p-3">
          <h4 className="text-[0.65rem] font-semibold text-muted-foreground uppercase tracking-wider mb-2">{section.label}</h4>
          <div className="space-y-2">
            {section.items.map((item) => {
              const ItemComp = ITEM_COMPONENTS[item.type];
              if (!ItemComp) return null;
              return (
                <ItemComp key={item.key} item={item} value={getValue(section.key, item.key)} onChange={(v: unknown) => updateValue(section.key, item.key, v)} />
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

function renderTab(tabId: TabId, ctx: SlotProps["ctx"]) {
  switch (tabId) {
    case "inquiry":
      return <InquiryTab ctx={ctx} />;
    case "patient":
      return <PatientTab ctx={ctx} />;
    case "exam":
      return <ExamTab ctx={ctx} />;
    case "nursing":
      return <NursingTab ctx={ctx} />;
  }
}

export function SidebarHost({ ctx, features }: SlotProps) {
  const [activeTab, setActiveTab] = useState<TabId | null>(null);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  const visibleTabs = TAB_DEFS.filter((t) => !t.featureFlag || features[t.featureFlag]);

  const handleTabClick = (tabId: TabId) => {
    setActiveTab((prev) => (prev === tabId ? null : tabId));
  };

  if (isMobile && activeTab) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col bg-background">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h3 className="text-sm font-semibold">{TAB_DEFS.find((t) => t.id === activeTab)?.label}</h3>
          <button onClick={() => setActiveTab(null)} className="size-8 rounded-md flex items-center justify-center hover:bg-muted">
            <X size={18} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">{renderTab(activeTab, ctx)}</div>
      </div>
    );
  }

  return (
    <div className="flex h-full border-l border-border bg-card">
      <div className="flex flex-col gap-0.5 p-1.5">
        {visibleTabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => handleTabClick(tab.id)}
            className={cn(
              "size-9 rounded-lg flex items-center justify-center transition-colors relative",
              activeTab === tab.id ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
            title={tab.label}
          >
            <tab.icon size={18} />
          </button>
        ))}
      </div>

      {activeTab && (
        <div className="w-72 border-l border-border bg-card overflow-y-auto p-3">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">{TAB_DEFS.find((t) => t.id === activeTab)?.label}</h3>
          {renderTab(activeTab, ctx)}
        </div>
      )}

      {!activeTab && isMobile && (
        <div className="flex items-center">
          <button
            onClick={() => setActiveTab(visibleTabs[0]?.id ?? null)}
            className="size-9 rounded-lg flex items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <ListChecks size={18} />
          </button>
        </div>
      )}
    </div>
  );
}
