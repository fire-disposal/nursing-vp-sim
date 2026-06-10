import { BarChart3 } from "lucide-react";
import type { PanelPlugin } from "@/engine/types";
import { ScoringDisplaySlot } from "./ScoringDisplaySlot";

export const scoringDisplayPlugin: PanelPlugin = {
  id: "scoring-display",
  meta: { name: "评分", description: "训练评分展示" },
  tab: { icon: BarChart3, label: "评分", priority: 99 },
  component: () => null,
};

export { ScoreCard } from "./ScoreCard";
export { ScoringOverlay } from "./ScoringOverlay";
export { ScoringDisplaySlot };
