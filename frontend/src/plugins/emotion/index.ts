import { Smile } from "lucide-react";
import type { PanelPlugin } from "@/engine/types";
import { EmotionTab } from "./EmotionTab";

export const emotionPlugin: PanelPlugin = {
  id: "emotion",
  featureFlag: "emotion",
  meta: { name: "情绪状态", description: "患者情绪状态机追踪" },
  tab: { icon: Smile, label: "情绪状态", priority: 5 },
  component: EmotionTab,
};
