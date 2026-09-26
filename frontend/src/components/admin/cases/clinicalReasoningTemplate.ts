/**
 * 临床判断训练（`workflow: "clinical_reasoning"`）的病例模板与字段提示。
 *
 * 为什么是模板而不是表单：临床判断病例的六个面（场景 / 证据目录 / 初始可见与隐藏 /
 * 未处置推进 / 三类目标 / 确定性锚点）是有引用关系的数据，做成逐字段表单会立刻变成第二个
 * schema owner（后端 `schemas/case_schema.py` + `modules/cases/validator.py` 才是唯一 owner）。
 * 这里只提供**一份可发布的骨架 + 期望字段清单**，作者在 JSON 视图里改，保存/发布时由
 * 服务端门禁给出字段级报告（`CaseValidationReportView` 直接渲染 errors[].field）。
 *
 * 骨架必须能过发布门禁：插入即可发布，再改内容 —— 模板本身不能是「填好再说」的半成品。
 */

import type { CaseJsonValue } from "./CaseEditorState";

/** 与后端注册表一致的 workflow id（`modules/training/profile.py::CLINICAL_REASONING`）。 */
export const CLINICAL_REASONING_WORKFLOW_ID = "clinical_reasoning";

/** 病例元数据键（只落 cases 列，docs/15 §六）：插入模板时保留作者已填的值。 */
const METADATA_KEYS = ["name", "difficulty", "time_limit", "description"] as const;

export interface ClinicalReasoningFieldHint {
	/** case_data 的 JSON 路径（与门禁报告里的 field 同名，便于对照）。 */
	path: string;
	label: string;
	requirement: string;
}

/** JSON 视图里逐条列出的期望字段（docs/15 §十六）。 */
export const CLINICAL_REASONING_FIELD_HINTS: ClinicalReasoningFieldHint[] = [
	{ path: "workflow", label: "工作区声明", requirement: '必须是 "clinical_reasoning"，否则病例会被当成问诊病例' },
	{ path: "scenario", label: "场景", requirement: "title / setting / summary 非空" },
	{
		path: "findings",
		label: "可获取证据目录",
		requirement: "非空；id 唯一；critical 证据必须能在 initial 里被拿到；隐藏证据必须有 obtainable_via",
	},
	{ path: "initial", label: "开场可见 / 隐藏", requirement: "两个列表互斥，且每条证据都必须出现在其中之一" },
	{
		path: "progression",
		label: "未处置的状态变化",
		requirement: "trigger.kind ∈ time|finding|objective；state_changes 非空（未声明只警告）",
	},
	{ path: "objectives", label: "训练目标", requirement: "must_notice / must_act / must_communicate 三组都非空" },
	{ path: "rubric", label: "确定性锚点", requirement: "anchors 非空；每个目标至少被一个锚点覆盖；weight > 0" },
];

/** 一份可发布的最小临床判断病例（术后低氧）。 */
export function createClinicalReasoningTemplate(): Record<string, CaseJsonValue> {
	return {
		workflow: CLINICAL_REASONING_WORKFLOW_ID,
		scenario: {
			title: "术后低氧",
			setting: "外科病房 · 术后 6 小时",
			summary: "患者术后 6 小时主诉气促，未吸氧状态下 SpO2 下降，需完成评估、取证、判断与处理。",
			learner_brief: "按阶段链完成：发现线索 → 获取证据 → 判断 → 行动 → 沟通。",
		},
		findings: [
			{
				id: "f.spo2",
				label: "SpO2 88%（未吸氧）",
				kind: "vital_sign",
				critical: true,
				obtainable_via: ["exam:vital_signs"],
			},
			{ id: "f.crp", label: "CRP 82 mg/L", kind: "lab", obtainable_via: ["lab:CBC+CRP"] },
			{ id: "f.sputum", label: "痰液粘稠、量少", kind: "observation" },
		],
		initial: { visible_findings: ["f.sputum"], hidden_findings: ["f.spo2", "f.crp"] },
		progression: [
			{
				id: "p.1",
				trigger: { kind: "time", after_minutes: 5 },
				state_changes: { spo2: 84 },
				description: "未吸氧 → 低氧加重",
			},
			{
				id: "p.2",
				trigger: { kind: "finding", ref: "f.spo2" },
				state_changes: { rr: 28 },
				description: "低氧确认后呼吸急促",
			},
		],
		objectives: {
			must_notice: [{ id: "n.1", label: "识别低氧", finding: "f.spo2" }],
			must_act: [{ id: "a.1", label: "立即给氧", action: "启动吸氧并复评 SpO2" }],
			must_communicate: [{ id: "c.1", label: "SBAR 报告医生", cue: "SBAR 报告 SpO2 88% 与吸氧后复评结果" }],
		},
		rubric: {
			anchors: [
				{
					id: "r.1",
					label: "发现低氧（关键证据）",
					rule: "objective_met",
					weight: 2,
					objectives: ["n.1"],
					findings: ["f.spo2"],
				},
				{ id: "r.2", label: "及时给氧", rule: "action_taken", weight: 3, objectives: ["a.1"] },
				{ id: "r.3", label: "沟通报告", rule: "communicated", weight: 2, objectives: ["c.1"] },
			],
		},
	};
}

/**
 * 用模板替换工作副本的内容面，**保留**病例元数据（name / description / difficulty / time_limit）。
 *
 * 刻意不保留旧内容：临床判断病例不得声明 `activities`（该 workflow 的 Activity 白名单为空），
 * 问诊字段（患者信息 / 示例对话 / 必询项）对它也没有消费端 —— 半保留只会产出过不了门禁、
 * 或者带着死内容的病例。
 */
export function withClinicalReasoningTemplate(
	current: Record<string, CaseJsonValue>,
): Record<string, CaseJsonValue> {
	const merged: Record<string, CaseJsonValue> = { ...createClinicalReasoningTemplate() };
	for (const key of METADATA_KEYS) {
		if (current[key] !== undefined) merged[key] = current[key];
	}
	return merged;
}
