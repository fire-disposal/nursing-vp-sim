import { Image } from "lucide-react";
import type { PanelPlugin } from "@/engine/types";
import { PortraitTab } from "./PortraitTab";

export const portraitPlugin: PanelPlugin = {
  id: "portrait",
  featureFlag: "portrait",
  requires: ["emotion"],
  meta: { name: "患者立绘", description: "高级患者表情立绘" },
  tab: { icon: Image, label: "患者立绘", priority: 7 },
  component: PortraitTab,
};
