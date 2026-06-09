import type { TrainingPlugin } from "@/engine/types";
import { DevToolsPanel } from "./DevToolsPanel";

export const devToolsPlugin: TrainingPlugin = {
  id: "dev-tools",
  name: "开发者工具",
  meta: {
    description: "实时插件状态监控、事件总线监控、Feature Flag 热切换",
    icon: "wrench",
    tags: ["dev", "debug", "panel"],
  },
  slots: {
    panel: DevToolsPanel,
  },
};
