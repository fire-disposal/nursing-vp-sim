import { Stethoscope } from "lucide-react";
import type { PanelPlugin } from "@/engine/types";
import { ExamPanel } from "./ExamPanel";

export const physicalExamPlugin: PanelPlugin = {
  id: "physical-exam",
  featureFlag: "physical_exam",
  meta: { name: "护理查体", description: "执行护理查体操作" },
  tab: { icon: Stethoscope, label: "护理查体", priority: 3 },
  component: ExamPanel,
};
