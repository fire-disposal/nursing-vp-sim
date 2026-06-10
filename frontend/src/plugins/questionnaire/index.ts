import { FileText } from "lucide-react";
import type { PanelPlugin } from "@/engine/types";
import { QuestionnaireOverlay } from "./QuestionnaireOverlay";

export const questionnairePlugin: PanelPlugin = {
  id: "questionnaire",
  featureFlag: "questionnaire",
  meta: { name: "问卷", description: "训前/训后问卷" },
  tab: { icon: FileText, label: "问卷", priority: 99 },
  component: () => null,
};

export { QuestionnaireOverlay };
