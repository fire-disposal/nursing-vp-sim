// frontend/src/plugins/patient-initiative/index.ts
import { api } from "@/api/axios-instance";
import type { TrainingPlugin } from "@/engine/types";

export const patientInitiativePlugin: TrainingPlugin = {
  id: "patient-initiative",
  name: "患者主动追问",
  featureFlag: "patient_initiative",
  requires: [],
  meta: {
    description: "监听患者主动追问状态，触发 initiative 轮询并展示",
    icon: "message-circle",
    tags: ["logic", "patient"],
  },
  pollConfig: {
    endpoint: `/training/{recordId}/state`,
    interval: 5000,
  },
  hooks: {
    onInit(ctx) {
      const recordId = Number(ctx.recordId);
      const timer = setInterval(async () => {
        try {
          const res = await api.get(`/training/${recordId}/state`);
          const data = res.data as any;
          if (data.initiative && data.initiative.should_trigger) {
            await api.post(`/training/${recordId}/initiative/trigger`);
            ctx.bus.emit("initiative:triggered");
          }
          ctx.bus.emit("initiative:state", data.initiative);
        } catch {
          /* ignore polling errors */
        }
      }, 5000);

      return () => clearInterval(timer);
    },
    onDestroy() {
      // cleanup handled by onInit return function
    },
  },
};
