import { ListChecks } from "lucide-react";
import type { PanelPlugin } from "@/engine/types";
import { InquiryTab } from "./InquiryTab";

export const inquiryPlugin: PanelPlugin = {
  id: "inquiry",
  meta: { name: "问诊进度", description: "展示问诊要求完成进度" },
  tab: {
    icon: ListChecks,
    label: "问诊进度",
    priority: 1,
    badge: (ctx) => {
      const inquiries = ctx.patient.requiredInquiries ?? [];
      if (inquiries.length === 0) return null;
      const studentMsgs = ctx.messages.filter((m) => m.role === "student");
      const done = inquiries.filter((inq) => studentMsgs.some((m) => (m.content ?? "").toLowerCase().includes(inq.toLowerCase().slice(0, 4)))).length;
      return { text: `${done}/${inquiries.length}`, variant: "default" };
    },
  },
  component: InquiryTab,
};
