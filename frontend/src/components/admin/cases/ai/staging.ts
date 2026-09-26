import type { CaseJsonValue } from "../CaseEditorState";

/**
 * 病例 AI 生成的字段表与差异/应用逻辑（纯函数，可单测）。
 *
 * 背景：生成结果此前直接 `SET_JSON` 整份覆盖编辑态，教师只能事后"撤销上一次"整份回退
 * （2026-09-26 审计 §7）。本模块把"覆盖"拆成「字段级差异 → 逐项接受 → 只写入被接受的路径」，
 * 保留既有快照/撤销作为兜底。
 */

export interface AiFieldDef {
	/** 编辑态 JSON 的点路径 */
	key: string;
	label: string;
}

export const AI_CLINICAL_FIELDS: AiFieldDef[] = [
	{ key: "chief_complaint", label: "主诉" },
	{ key: "opening_line", label: "开场白" },
	{ key: "present_illness", label: "现病史" },
	{ key: "past_history", label: "既往史" },
	{ key: "medication_history", label: "用药史" },
	{ key: "allergy_history", label: "过敏史" },
	{ key: "family_history", label: "家族史" },
	{ key: "social_history", label: "生活史" },
	{ key: "communication_style", label: "沟通风格" },
	{ key: "personality", label: "人格" },
	{ key: "patient_info", label: "患者信息" },
];

export const AI_PEDAGOGY_FIELDS: AiFieldDef[] = [
	{ key: "hidden_info", label: "隐藏信息" },
	{ key: "required_inquiries", label: "必询要点" },
	{ key: "deep_background", label: "深层背景" },
	// 查体锚点的唯一落点是 Activity 声明（docs/15 §四）；旧的顶层 exam_anchors 已退场。
	{ key: "activities.physical_exam.config", label: "查体锚点" },
	{ key: "example_dialogues", label: "示例对话" },
];

export const ALL_FIELD_LABELS: Record<string, string> = Object.fromEntries(
	[...AI_CLINICAL_FIELDS, ...AI_PEDAGOGY_FIELDS].map((f) => [f.key, f.label]),
);

/** 参与差异比较的路径：逐字段生成的全部字段 + 病例元数据（核心阶段会一并给出）。 */
export const CASE_AI_DIFF_FIELDS: AiFieldDef[] = [
	{ key: "name", label: "病例名称" },
	{ key: "difficulty", label: "难度" },
	{ key: "time_limit", label: "时间限制" },
	...AI_CLINICAL_FIELDS,
	...AI_PEDAGOGY_FIELDS,
];

export interface AiChange {
	path: string;
	label: string;
	before: unknown;
	after: unknown;
}

type Json = Record<string, CaseJsonValue>;

function getPath(obj: unknown, path: string): unknown {
	let current: unknown = obj;
	for (const k of path.split(".")) {
		if (current == null || typeof current !== "object") return undefined;
		current = (current as Record<string, unknown>)[k];
	}
	return current;
}

function setPath(obj: Json, path: string, value: unknown): Json {
	const keys = path.split(".");
	const result: Json = { ...obj };
	let current: Record<string, unknown> = result;
	for (let i = 0; i < keys.length - 1; i++) {
		const k = keys[i];
		const next = current[k];
		current[k] =
			next != null && typeof next === "object" && !Array.isArray(next)
				? { ...(next as Record<string, unknown>) }
				: {};
		current = current[k] as Record<string, unknown>;
	}
	current[keys[keys.length - 1]] = value as CaseJsonValue;
	return result;
}

/** 找出生成结果相对当前编辑态的变化；未出现在生成结果里的字段不算变化。 */
export function diffCaseData(before: Json, after: Json): AiChange[] {
	const changes: AiChange[] = [];
	for (const field of CASE_AI_DIFF_FIELDS) {
		const next = getPath(after, field.key);
		if (next === undefined) continue;
		const prev = getPath(before, field.key);
		if (JSON.stringify(prev ?? null) === JSON.stringify(next ?? null)) continue;
		changes.push({ path: field.key, label: field.label, before: prev, after: next });
	}
	return changes;
}

/** 只把被接受的路径写回：未接受的字段保持教师当前内容。
 *
 * `accepted` 用路径数组而非 Set/Record：调用方（差异面板）天然按顺序渲染与勾选，
 * 字段数 ≤ 20，线性查找比维护第二份索引更简单。
 */
export function applyAcceptedChanges(base: Json, changes: AiChange[], accepted: readonly string[]): Json {
	let next = base;
	for (const change of changes) {
		if (!accepted.includes(change.path)) continue;
		next = setPath(next, change.path, change.after);
	}
	return next;
}

/** 差异面板里的值摘要：长文本截断、数组给条数、对象给 JSON 片段。 */
export function summarizeValue(value: unknown, max = 72): string {
	if (value == null || value === "") return "（空）";
	if (Array.isArray(value)) {
		if (value.length === 0) return "（空列表）";
		const text = value.map((v) => (typeof v === "string" ? v : JSON.stringify(v))).join("；");
		return `${value.length} 条：${text.length > max ? `${text.slice(0, max)}…` : text}`;
	}
	if (typeof value === "object") {
		const text = JSON.stringify(value);
		return text.length > max ? `${text.slice(0, max)}…` : text;
	}
	const text = String(value);
	return text.length > max ? `${text.slice(0, max)}…` : text;
}
