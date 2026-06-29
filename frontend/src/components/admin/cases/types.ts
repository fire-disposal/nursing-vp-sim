import type { components } from "@/api/api-types.gen";

type Schemas = components["schemas"];
export type CaseManageItem = Schemas["CaseManageItem"];

export interface ScoringCriteriaItem {
	name: string;
	score?: number;
	anchors?: Record<string, string>;
}

export interface ScoringDimension extends Record<string, unknown> {
	name: string;
	max: number;
	description: string;
	items: ScoringCriteriaItem[];
}

export interface CaseForm {
	name: string;
	time_limit: number;
	difficulty: number;
	training_type: string;
	description: string;
	patient_name: string;
	patient_age: number;
	patient_gender: string;
	chief_complaint: string;
	opening_line: string;
	present_illness: string;
	past_history: string;
	medication_history: string;
	allergy_history: string;
	family_history: string;
	social_history: string;
	communication_style: string;
	voice_type: string;
	hidden_info: string[];
	required_inquiries: string[];
	scoring_criteria: Record<string, ScoringDimension>;
	supported_plugins: string[];
}

export interface CaseData {
	[key: string]: unknown;
	name: string;
	time_limit: number;
	difficulty: number;
	training_type?: string;
	description: string;
	patient_info?: { name: string; age: number; gender: string };
	chief_complaint: string;
	opening_line: string;
	present_illness: string;
	past_history: string;
	medication_history: string;
	allergy_history: string;
	family_history: string;
	social_history: string;
	communication_style: string;
	voice_type?: string;
	hidden_info: string[];
	required_inquiries: string[];
	scoring_criteria: Record<string, ScoringDimension>;
	supported_plugins: string[];
}

export interface CaseJsonData {
	name?: string;
	time_limit?: number;
	difficulty?: number;
	training_type?: string;
	description?: string;
	chief_complaint?: string;
	opening_line?: string;
	present_illness?: string;
	past_history?: string;
	medication_history?: string;
	allergy_history?: string;
	family_history?: string;
	social_history?: string;
	communication_style?: string;
	voice_type?: string;
	hidden_info?: string[];
	required_inquiries?: string[];
	scoring_criteria?: Record<string, ScoringDimension>;
	supported_plugins?: string[];
	patient_info?: {
		name?: string;
		age?: number;
		gender?: string;
	};
}

export const NEW_CASE_TEMPLATE: CaseData = {
	name: "",
	time_limit: 20,
	difficulty: 1,
	training_type: "history_taking",
	description: "",
	patient_info: { name: "", age: 0, gender: "" },
	chief_complaint: "",
	opening_line: "",
	present_illness: "",
	past_history: "",
	medication_history: "",
	allergy_history: "",
	family_history: "",
	social_history: "",
	communication_style: "",
	voice_type: "",
	hidden_info: [],
	required_inquiries: [],
	scoring_criteria: {
		沟通技能: { name: "沟通技能", max: 42, description: "", items: [] },
		病史采集: { name: "病史采集", max: 15, description: "", items: [] },
	},
	supported_plugins: [],
};

export const inputClass =
	"w-full px-2.5 py-1.5 border border-border rounded-md text-sm bg-card text-foreground focus-ring";

export const textareaClass =
	"w-full px-2.5 py-1.5 border border-border rounded-md text-sm bg-card text-foreground focus-ring resize-y";

export function buildCaseData(form: CaseForm): CaseData {
	return {
		name: form.name,
		time_limit: form.time_limit,
		difficulty: form.difficulty,
		training_type: form.training_type,
		description: form.description,
		patient_info: {
			name: form.patient_name,
			age: form.patient_age,
			gender: form.patient_gender,
		},
		chief_complaint: form.chief_complaint,
		opening_line: form.opening_line,
		present_illness: form.present_illness,
		past_history: form.past_history,
		medication_history: form.medication_history,
		allergy_history: form.allergy_history,
		family_history: form.family_history,
		social_history: form.social_history,
		communication_style: form.communication_style,
		voice_type: form.voice_type || undefined,
		hidden_info: form.hidden_info,
		required_inquiries: form.required_inquiries,
		scoring_criteria: form.scoring_criteria,
		supported_plugins: form.supported_plugins,
	};
}

export function parseCaseData(cd: unknown): CaseForm {
	const rec = cd as CaseJsonData | null;
	const info = rec?.patient_info ?? {};
	return {
		name: rec?.name || "",
		time_limit: rec?.time_limit || 20,
		difficulty: rec?.difficulty || 1,
		training_type: rec?.training_type || "history_taking",
		description: rec?.description || "",
		patient_name: info.name || "",
		patient_age: info.age || 0,
		patient_gender: info.gender || "",
		chief_complaint: rec?.chief_complaint || "",
		opening_line: rec?.opening_line || "",
		present_illness: rec?.present_illness || "",
		past_history: rec?.past_history || "",
		medication_history: rec?.medication_history || "",
		allergy_history: rec?.allergy_history || "",
		family_history: rec?.family_history || "",
		social_history: rec?.social_history || "",
		communication_style: rec?.communication_style || "",
		voice_type: rec?.voice_type || "",
		hidden_info: rec?.hidden_info || [],
		required_inquiries: rec?.required_inquiries || [],
		scoring_criteria: rec?.scoring_criteria || {},
		supported_plugins: rec?.supported_plugins || [],
	};
}

export function difficultyLabel(d: number): string {
	return d === 1 ? "初级" : d === 2 ? "中级" : d === 3 ? "高级" : "-";
}
