// frontend/src/plugins/physical-exam/index.ts
import type { TrainingPlugin } from "@/engine/types";
import { ExamPanel } from "./ExamPanel";

export const physicalExamPlugin: TrainingPlugin = {
  id: "physical-exam",
  name: "护理查体操作",
  featureFlag: "physical_exam",
  meta: {
    description: "查体操作面板：血压/体温/血氧/心率等",
    icon: "stethoscope",
    tags: ["ui", "panel", "exam"],
  },
  slots: {
    panel: ExamPanel,
  },
};
