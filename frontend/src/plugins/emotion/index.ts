import { Smile } from "lucide-react";
import type { PanelPlugin } from "@/engine/types";
import { EmotionTab } from "./EmotionTab";

export const emotionPlugin: PanelPlugin = {
  id: "emotion",
  featureFlag: "emotion",
  meta: { name: "情绪状态", description: "患者情绪状态机追踪" },
  tab: { icon: Smile, label: "情绪状态", priority: 5 },
  component: EmotionTab,
  hooks: {
    afterReceive: async (msg, ctx) => {
      if (msg.role !== "patient") return msg;
      try {
        const { getTrainingState } = await import("@/api/training-state");
        const res = await getTrainingState(Number(ctx.recordId));
        const emotion = res.data.emotion;
        if (emotion?.state) {
          ctx.bus.emit("emotion:changed", { emotion: emotion.state });
        }
      } catch {
        /* ignore poll errors */
      }
      return msg;
    },
  },
};
