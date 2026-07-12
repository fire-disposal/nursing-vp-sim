// LLM 用途单一来源 —— 与后端 backend/core/llm_profile.py 的 PROFILES 保持一致。
// 新增/调整用途时同步修改两处。通配符 "*" 已退役，不再是有效用途。

export interface LlmPurpose {
	value: string;
	label: string;
	desc: string;
	icon: string;
}

export const LLM_PURPOSES: LlmPurpose[] = [
	{
		value: "patient_chat",
		label: "患者对话",
		desc: "学生模拟问诊时的患者回复（Flash）",
		icon: "💬",
	},
	{
		value: "qa",
		label: "问答",
		desc: "学生自由提问的 AI 导师（Flash）",
		icon: "❓",
	},
	{
		value: "scoring",
		label: "评分",
		desc: "训练对话结束后自动评分（Pro）",
		icon: "📊",
	},
	{
		value: "scoring_feedback",
		label: "评分反馈",
		desc: "评分后的反馈与建议生成（Pro）",
		icon: "📝",
	},
	{
		value: "case_generation",
		label: "病例生成",
		desc: "AI 辅助生成训练病例（Flash）",
		icon: "📋",
	},
];

// 用途 value → 中文标签。含 "other" 兜底（调用日志中未知用途的显示）。
export const LLM_PURPOSE_LABELS: Record<string, string> = {
	...Object.fromEntries(LLM_PURPOSES.map((p) => [p.value, p.label])),
	other: "其他",
};
