// frontend/src/plugins/scoring-display/index.ts
import type { TrainingPlugin } from "@/engine/types";
import { ScoringDisplaySlot } from "./ScoringDisplaySlot";

export const scoringDisplayPlugin: TrainingPlugin = {
  id: "scoring-display",
  name: "评分展示",
  meta: {
    description: "训练结束后的进度条覆盖 + 评分报告弹窗",
    icon: "trophy",
    tags: ["ui", "overlay", "scoring"],
  },
  slots: {
    overlay: ScoringDisplaySlot,
  },
};
