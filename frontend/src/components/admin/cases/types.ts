import type { components } from "@/api/api-types.gen";

type Schemas = components["schemas"];
export type CaseManageItem = Schemas["CaseManageItem"] & { is_open?: boolean };

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
	capabilities: Record<string, boolean>;
	arrival_mode: string;
	red_flags: string[];
	hr: number;
	bp_sys: number;
	bp_dia: number;
	rr: number;
	spo2: number;
	temp: number;
	consciousness: string;
	mews_score: number;
	triage_category: string;
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
	capabilities: Record<string, boolean>;
	triage_info?: {
		arrival_mode?: string;
		red_flags?: string[];
		vitals?: {
			hr?: number;
			bp_sys?: number;
			bp_dia?: number;
			rr?: number;
			spo2?: number;
			temp?: number;
		};
		consciousness?: string;
		mews_score?: number;
		triage_category?: string;
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
	capabilities: {},
	triage_info: {
		arrival_mode: "walk",
		red_flags: [],
		vitals: {
			hr: 0,
			bp_sys: 0,
			bp_dia: 0,
			rr: 0,
			spo2: 0,
			temp: 0,
		},
		consciousness: "alert",
		mews_score: 0,
		triage_category: "",
	},
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
		capabilities: form.capabilities,
		...(form.training_type === "triage"
			? {
					arrival_mode: form.arrival_mode,
					red_flags: form.red_flags,
					vitals: {
						hr: form.hr,
						bp_sys: form.bp_sys,
						bp_dia: form.bp_dia,
						rr: form.rr,
						spo2: form.spo2,
						temp: form.temp,
					},
					consciousness: form.consciousness,
					mews_score: form.mews_score,
					triage_category: form.triage_category,
				}
			: {}),
	};
}

export function parseCaseData(cd: unknown): CaseForm {
	const rec = cd as Record<string, any> | null;
	const info = rec?.patient_info ?? {};
	const ti = rec?.triage_info;
	const vitals = rec?.vitals ?? ti?.vitals ?? {};
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
		capabilities: (rec?.capabilities || {}) as Record<string, boolean>,
		arrival_mode: rec?.arrival_mode || ti?.arrival_mode || "",
		red_flags: rec?.red_flags || ti?.red_flags || [],
		hr: vitals.hr ?? 0,
		bp_sys: vitals.bp_sys ?? 0,
		bp_dia: vitals.bp_dia ?? 0,
		rr: vitals.rr ?? 0,
		spo2: vitals.spo2 ?? 0,
		temp: vitals.temp ?? 0,
		consciousness: rec?.consciousness || ti?.consciousness || "alert",
		mews_score: rec?.mews_score ?? ti?.mews_score ?? 0,
		triage_category: rec?.triage_category || ti?.triage_category || "",
	};
}

export function difficultyLabel(d: number): string {
	return d === 1 ? "初级" : d === 2 ? "中级" : d === 3 ? "高级" : "-";
}
