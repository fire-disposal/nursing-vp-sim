import { MessageCircle } from "lucide-react";
import type { PanelPlugin } from "@/engine/types";
import { InitiativeTab } from "./InitiativeTab";

export const initiativePlugin: PanelPlugin = {
  id: "initiative",
  featureFlag: "patient_initiative",
  meta: { name: "主动追问", description: "患者定时主动追问" },
  tab: {
    icon: MessageCircle,
    label: "主动追问",
    priority: 6,
  },
  component: InitiativeTab,
  hooks: {
    onInit: (ctx) => {
      const interval = setInterval(async () => {
        try {
          const { getTrainingState, triggerInitiative } = await import("@/api/training-state");
          const state = await getTrainingState(Number(ctx.recordId));
          const initiative = state.data.initiative;
          ctx.bus.emit("initiative:state", initiative);

          if ((initiative as any)?.should_trigger) {
            const res = await triggerInitiative(Number(ctx.recordId));
            if (res.data.triggered && res.data.message) {
              ctx.bus.emit("initiative:triggered", { content: res.data.message });
            }
          }
        } catch {
          /* ignore poll errors */
        }
      }, 5000);

      return () => clearInterval(interval);
    },
  },
};
