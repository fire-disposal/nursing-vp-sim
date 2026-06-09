import type { TrainingPlugin } from "@/engine/types";
import { TrainingHeader } from "./TrainingHeader";

export const trainingHeaderPlugin: TrainingPlugin = {
  id: "training-header",
  name: "训练页眉",
  meta: {
    description: "患者头像、姓名、病案标题、倒计时、问诊进度、护理记录、语音开关、结束训练",
    icon: "panel-top",
    tags: ["ui", "header", "core"],
  },
  slots: {
    header: TrainingHeader,
  },
};
