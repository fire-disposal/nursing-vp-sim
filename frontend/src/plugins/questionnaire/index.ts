// frontend/src/plugins/questionnaire/index.ts
import type { TrainingPlugin } from "@/engine/types";
import { QuestionnaireOverlay } from "./QuestionnaireOverlay";

export const questionnairePlugin: TrainingPlugin = {
  id: "questionnaire",
  name: "训练问卷",
  meta: {
    description: "训练前/后问卷调查",
    icon: "clipboard-check",
    tags: ["ui", "overlay", "assessment"],
  },
  slots: {
    overlay: QuestionnaireOverlay,
  },
};
