import type { TrainingPlugin } from "@/engine/types";
import { InquirySidebar } from "./InquirySidebar";

export const inquiryPlugin: TrainingPlugin = {
  id: "inquiry",
  name: "问诊进度",
  meta: {
    description: "显示必问问诊项完成进度",
    icon: "clipboard-list",
    tags: ["ui", "header"],
  },
  slots: {
    header: InquirySidebar,
    "sidebar-tray": InquirySidebar,
  },
};
