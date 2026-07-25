import type { ComponentType } from "react";
import type { TrainingTool, TrainingToolProps } from "@/engine/TrainingTool";
import InquiryTool from "./InquiryTool";
import MewsTool from "./MewsTool";
import NursingRecordTool from "./NursingRecordTool";
import PatientInfoTool from "./PatientInfoTool";
import PhysicalExamTool from "./PhysicalExamTool";
import QuizTool from "./QuizTool";

export const TOOL_META: Record<string, { icon: string; title: string }> = {
  "patient-info":   { icon: "👤", title: "患者信息" },
  "inquiry":        { icon: "📋", title: "问诊指引" },
  "physical-exam":  { icon: "💓", title: "护理查体" },
  "nursing-record": { icon: "📄", title: "护理记录" },
  "mews":           { icon: "📊", title: "MEWS 评分" },
  "quiz":           { icon: "❓", title: "引导题目" },
};

interface ToolDef {
  id: string;
  component: ComponentType<TrainingToolProps>;
  capability?: string;
  priority: number;
}

const HISTORY_TAKING: ToolDef[] = [
  { id: "patient-info",   component: PatientInfoTool,                                  priority: 0 },
  { id: "inquiry",        component: InquiryTool,                                      priority: 1 },
  { id: "physical-exam",  component: PhysicalExamTool,                                 priority: 2, capability: "physical_exam" },
  { id: "nursing-record", component: NursingRecordTool,                                priority: 3, capability: "nursing_record" },
  { id: "mews",           component: MewsTool,                                         priority: 4, capability: "mews" },
  { id: "quiz",           component: QuizTool,                                         priority: 5, capability: "quiz" },
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
