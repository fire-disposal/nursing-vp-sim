import { Image } from "lucide-react";
import type { EmotionState } from "@/engine/PluginContext";
import type { PanelPlugin } from "@/engine/types";
import { PortraitTab } from "./PortraitTab";

const EMOTION_FILES: Record<EmotionState, string> = {
  withdrawn: "withdrawn.png",
  defensive: "defensive.png",
  neutral: "neutral.png",
  relaxed: "relaxed.png",
  open: "open.png",
};

export const portraitPlugin: PanelPlugin = {
  id: "portrait",
  featureFlag: "portrait",
  meta: { name: "患者立绘", description: "高级患者表情立绘" },
  tab: { icon: Image, label: "患者立绘", priority: 7 },
  component: PortraitTab,
  hooks: {
    afterReceive: async (msg, ctx) => {
      if (msg.role !== "patient") return msg;
      try {
        const { getTrainingState } = await import("@/api/training-state");
        const res = await getTrainingState(Number(ctx.recordId));
        const emotion = res.data.emotion?.state as EmotionState;
        if (emotion) {
          const portraitUrl = `/portraits/${ctx.patient.caseTitle || "default"}/${EMOTION_FILES[emotion] || "neutral.png"}`;
          ctx.bus.emit("portrait:changed", { url: portraitUrl });
        }
      } catch {
        /* ignore */
      }
      return msg;
    },
  },
};
