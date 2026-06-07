import type { components } from "@/api/api-types.gen";

type Schemas = components["schemas"];
export type PromptTemplateResponse = Schemas["PromptTemplateResponse"];
export type PromptValidateResponse = Schemas["PromptValidateResponse"];

export interface VariableMeta {
  name: string;
  type?: string;
  desc?: string;
  source?: string;
  example?: string;
  default_value?: string;
}

export interface PromptForm {
  purpose: string;
  name: string;
  system_prompt: string;
  user_prompt: string;
  remark: string;
  activate: boolean;
}

export const PURPOSES = ["patient_chat", "scoring", "scoring_feedback", "qa", "case_generation", "*"];

export const PURPOSE_LABELS: Record<string, string> = {
  patient_chat: "患者对话",
  scoring: "评分",
  scoring_feedback: "评分反馈",
  qa: "问答",
  case_generation: "病例生成",
  "*": "通配",
};

export const inputBase = "w-full py-1 px-2 border border-border rounded-lg text-sm bg-card text-foreground focus:outline-none focus:border-blue-500";
