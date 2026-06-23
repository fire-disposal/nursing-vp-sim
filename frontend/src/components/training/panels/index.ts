import { ClipboardList, ListChecks, MessageCircle, Stethoscope, User } from "lucide-react";
import type { ComponentType } from "react";
import type { BadgeInfo, PanelTabProps, PluginContext } from "@/engine/types";
import { InitiativeTab } from "./initiative/InitiativeTab";
import { InquiryTab } from "./inquiry/InquiryTab";
import { NURSING_RECORD_SHEET_CONFIG } from "./nursing-record/config";
import { NursingRecordPanel } from "./nursing-record/NursingRecordPanel";
import { PatientInfoTab } from "./patient-info/PatientInfoTab";
import { ExamPanel } from "./physical-exam/ExamPanel";

export interface PanelConfig {
  id: string;
  icon: ComponentType<{ size?: number }>;
  label: string;
  priority: number;
  component: ComponentType<PanelTabProps>;
  badge?: (ctx: PluginContext) => BadgeInfo | null;
  featureFlag?: string;
}

function inquiryBadge(ctx: PluginContext): BadgeInfo | null {
  const inquiries = ctx.patient.requiredInquiries ?? [];
  if (inquiries.length === 0) return null;
  const studentMsgs = ctx.messages.filter((m) => m.role === "student");
  const keywords = inquiries.map((inq) => inq.split(/[,，、\s]+/).filter(Boolean));
  const done = keywords.filter((kws) =>
    kws.some((kw) => studentMsgs.some((m) => (m.content ?? "").toLowerCase().includes(kw.toLowerCase()))),
  ).length;
  return { text: `${done}/${inquiries.length}`, variant: "default" };
}

const NR_TOTAL_ITEMS = NURSING_RECORD_SHEET_CONFIG.sections.reduce((sum, s) => sum + s.items.length, 0);

function nursingRecordBadge(ctx: PluginContext): BadgeInfo | null {
  try {
    const raw = localStorage.getItem(`nursing_record_sheet_${ctx.recordId}`);
    const data = raw ? JSON.parse(raw) : {};
    let count = 0;
    for (const section of NURSING_RECORD_SHEET_CONFIG.sections) {
      const sectionData = data[section.key] || {};
      for (const item of section.items) {
        const val = sectionData[item.key];
        if (val !== undefined && val !== null && val !== "") count++;
      }
    }
    return { text: `${count}/${NR_TOTAL_ITEMS}`, variant: "default" };
  } catch {
    return null;
  }
}

function countTotalOps(anchors: Record<string, unknown> | undefined): number {
  if (!anchors) return 0;
  const groups = (anchors as any).groups as Array<{ ops: unknown[] }> | undefined;
  if (Array.isArray(groups)) return groups.reduce((sum, g) => sum + g.ops.length, 0);
  let total = 0;
  const vs = anchors.vital_signs as Record<string, unknown> | undefined;
  if (vs) total += Object.keys(vs).length;
  if (anchors.skin) total++;
  if (anchors.pain_score !== undefined) total++;
  return total;
}

function examBadge(ctx: PluginContext): BadgeInfo | null {
  const totalOps = countTotalOps(ctx.patient?.examAnchors);
  if (totalOps === 0) return null;
  let count = 0;
  const seen = new Set<string>();
  for (const msg of ctx.messages) {
				if (msg.examResult?.type && !seen.has(msg.examResult.type)) {
					seen.add(msg.examResult.type);
					count++;
				}
				if (msg.role === "system") {
      const stripped = (msg.content ?? "").replace(/[:\s]/g, "");
      if (stripped.includes("生命体征") || stripped.includes("体温") || stripped.includes("心率") ||
          stripped.includes("血压") || stripped.includes("血氧") || stripped.includes("呼吸") ||
          stripped.includes("皮肤") || stripped.includes("疼痛")) {
        const key = stripped.slice(0, 6);
        if (!seen.has(key)) { seen.add(key); count++; }
      }
    }
  }
  if (count === 0) return null;
  return { text: `${count}/${totalOps}`, variant: "default" as const };
}

export const PANELS: PanelConfig[] = [
  { id: "patient-info", icon: User, label: "患者信息", priority: 0, component: PatientInfoTab },
  { id: "inquiry", icon: ListChecks, label: "问诊清单", priority: 1, component: InquiryTab, badge: inquiryBadge },
  { id: "physical-exam", icon: Stethoscope, label: "护理查体", priority: 3, component: ExamPanel, featureFlag: "physical_exam", badge: examBadge },
  { id: "nursing-record", icon: ClipboardList, label: "护理记录", priority: 4, component: NursingRecordPanel, badge: nursingRecordBadge },
  { id: "initiative", icon: MessageCircle, label: "自主反应", priority: 6, component: InitiativeTab, featureFlag: "patient_initiative" },
];

export function getActivePanels(features: Record<string, boolean>) {
  return PANELS
    .filter((p) => !p.featureFlag || features[p.featureFlag])
    .sort((a, b) => a.priority - b.priority);
}
