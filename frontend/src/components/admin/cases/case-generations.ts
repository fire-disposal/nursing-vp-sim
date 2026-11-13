import type { CaseJsonValue } from "./CaseEditorState";
import { getDefaultCaseJson } from "./CaseEditorState";
import {
	METADATA_KEYS,
	withClinicalReasoningTemplate,
} from "./clinicalReasoningTemplate";

export type CaseWorkflowId = "history_taking" | "clinical_reasoning";

export interface CaseGeneration {
	id: CaseWorkflowId | "v3";
	generation: "V1" | "V2" | "V3";
	label: string;
	description: string;
	available: boolean;
}

/** 作者面代际入口；V3 仅说明未来方向，不写入未登记的 workflow。 */
export const CASE_GENERATIONS: readonly CaseGeneration[] = [
	{
		id: "history_taking",
		generation: "V1",
		label: "病史采集",
		description: "护患对话、床旁检查、护理记录与评分反馈",
		available: true,
	},
	{
		id: "clinical_reasoning",
		generation: "V2",
		label: "证据驱动训练",
		description: "场景、证据、行动、沟通与确定性锚点",
		available: true,
	},
	{
		id: "v3",
		generation: "V3",
		label: "动态世界",
		description: "病情演化与行动后果；概念资产阶段，暂不可创建",
		available: false,
	},
];

export function isCaseWorkflowId(value: string): value is CaseWorkflowId {
	return value === "history_taking" || value === "clinical_reasoning";
}

export function generationOf(workflow: string | undefined): CaseGeneration {
	return CASE_GENERATIONS.find((item) => item.id === (workflow || "history_taking")) ?? CASE_GENERATIONS[0];
}

/** 代际切换替换整份内容模板，仅保留公共元数据，避免残留另一代际字段。 */
export function withGenerationTemplate(
	current: Record<string, CaseJsonValue>,
	workflow: CaseWorkflowId,
): Record<string, CaseJsonValue> {
	if (workflow === "clinical_reasoning") return withClinicalReasoningTemplate(current);
	const next = getDefaultCaseJson();
	for (const key of METADATA_KEYS) next[key] = current[key];
	return next;
}
