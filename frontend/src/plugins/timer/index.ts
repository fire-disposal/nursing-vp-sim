import type { TrainingPlugin } from "@/engine/types";
import { TimerDisplay } from "./TimerDisplay";

export const timerPlugin: TrainingPlugin = {
  id: "timer",
  name: "倒计时",
  meta: {
    description: "训练倒计时，超时自动结束训练",
    icon: "clock",
    tags: ["ui", "header"],
  },
  slots: {
    header: TimerDisplay,
  },
};
