// HeartPulse（lucide）在 tabler 无同名图标，语义上取 IconHeartbeat（心跳脉冲线）。
import { IconClipboardList, IconFileText, IconHeartbeat, IconHelpCircle, IconStethoscope, type TablerIcon } from "@tabler/icons-react";
import type { ComponentType } from "react";
import type { TrainingTool, TrainingToolProps } from "@/engine/TrainingTool";
import NursingDiagnosisTool from "./NursingDiagnosisTool";
import InquiryTool from "./InquiryTool";
import NursingRecordTool from "./NursingRecordTool";
import PhysicalExamTool from "./PhysicalExamTool";
import QuizTool from "./QuizTool";

export const TOOL_META: Record<string, { icon: TablerIcon; title: string }> = {
  "inquiry": { icon: IconClipboardList, title: "问诊指引" },
  "physical-exam": { icon: IconHeartbeat, title: "护理查体" },
  "nursing-record": { icon: IconFileText, title: "护理记录" },
  "nursing-diagnosis": { icon: IconStethoscope, title: "护理诊断" },
  "quiz": { icon: IconHelpCircle, title: "引导题目" },
};
interface ToolDef {
  id: string;
  component: ComponentType<TrainingToolProps>;
  capability?: string;
  priority: number;
}

const HISTORY_TAKING: ToolDef[] = [
  { id: "inquiry",             component: InquiryTool,                                       priority: 1 },
  { id: "physical-exam",       component: PhysicalExamTool,                                  priority: 2, capability: "physical_exam" },
  { id: "nursing-diagnosis",   component: NursingDiagnosisTool,                              priority: 3, capability: "nursing_diagnosis" },
  { id: "nursing-record",      component: NursingRecordTool,                                 priority: 4, capability: "nursing_record" },
  { id: "quiz",                component: QuizTool,                                          priority: 6, capability: "quiz" },
];


const REGISTRY: Record<string, ToolDef[]> = {
  history_taking: HISTORY_TAKING,
};

export function getTools(_trainingType: string, capabilities: Record<string, boolean>): TrainingTool[] {
  const defs = REGISTRY.history_taking;
  return defs
    .filter((c) => !c.capability || capabilities[c.capability])
    .sort((a, b) => a.priority - b.priority)
    .map(({ id, component, priority, capability }) => ({ id, component, priority, capability } as TrainingTool));
}
