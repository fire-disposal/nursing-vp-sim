import type { TrainingPlugin } from "@/engine/types";
import { SidebarHost } from "./SidebarHost";

export const sidebarHostPlugin: TrainingPlugin = {
  id: "sidebar-host",
  name: "侧栏面板",
  meta: {
    description: "TAB式右侧面板：问诊进度 / 患者情况 / 护理查体 / 护理记录",
    icon: "panel-right",
    tags: ["ui", "panel", "core"],
  },
  slots: {
    panel: SidebarHost,
  },
};
