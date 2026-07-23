import type { components } from "@/api/api-types.gen";

type CaseBrief = components["schemas"]["CaseBrief"];

export interface CaseFormData {
	name: string;
	difficulty: number;
	time_limit: number;
	description: string;

	patient_info: PatientInfo;
	chief_complaint: string;
	opening_line: string;

	personality: PersonalityConfig;
	communication_style: string;

	present_illness: string;
	past_history: string;
	medication_history: string;
	allergy_history: string;
	family_history: string;
	social_history: string;
	voice_type: string;

	exam_anchors: Record<string, string>;
	quiz: QuizFormData;
	phases: PhaseFormData[];
	deep_background: Record<string, string>;
	example_dialogues: DialogPair[];

	hidden_info: string[];
	required_inquiries: string[];

	arrival_mode: string;
	red_flags: string[];
	vitals: TriageVitals;
	consciousness: string;
	mews_score: number;
	triage_category: string;
}

export interface PatientInfo {
	name: string;
	age: number;
	gender: "男" | "女";
	visible_symptoms: string[];
	expression: string;
}

export interface PersonalityConfig {
	health_literacy: "low" | "normal" | "high" | "medium";
	verbosity: "terse" | "normal" | "verbose";
	anxiety_trait: "calm" | "normal" | "anxious";
	patience: "low" | "normal" | "high";
	mood: "neutral" | "low" | "irritable" | "fearful";
	compliance: "resistant" | "normal" | "dependent";
}

export interface QuizFormData {
	title: string;
	questions: QuizQuestion[];
}

export interface QuizQuestion {
	id: string;
	stem: string;
	options: QuizOption[];
	answer: string;
	explanation: string;
}

export interface QuizOption {
	key: string;
	text: string;
}

export interface PhaseFormData {
	id: string;
	name: string;
	order: number;
	operations: string[];
	prompt_profile: string;
	transition: PhaseTransition;
}

export interface PhaseTransition {
	auto: boolean;
	manual_label: string;
	min_messages: number;
	min_operations: number;
	auto_after_messages: number;
}

export interface DialogPair {
	question: string;
	answer: string;
}

export interface TriageVitals {
	hr: number;
	bp_sys: number;
	bp_dia: number;
	rr: number;
	spo2: number;
	temp: number;
}

export const DEFAULT_PATIENT: PatientInfo = {
	name: "",
	age: 45,
	gender: "男",
	visible_symptoms: [],
	expression: "neutral",
};

export const DEFAULT_PERSONALITY: PersonalityConfig = {
	health_literacy: "normal",
	verbosity: "normal",
	anxiety_trait: "normal",
	patience: "normal",
	mood: "neutral",
	compliance: "normal",
};

export const DEFAULT_QUIZ: QuizFormData = {
	title: "",
	questions: [],
};

export function emptyQuizQuestion(): QuizQuestion {
	return { id: `q${Date.now()}`, stem: "", options: [], answer: "", explanation: "" };
}

export function emptyQuizOption(): QuizOption {
	return { key: "", text: "" };
}

export function emptyPhase(order: number): PhaseFormData {
	return {
		id: `phase_${order}`,
		name: "",
		order,
		operations: [],
		prompt_profile: "patient_chat",
		transition: {
			auto: false,
			manual_label: "",
			min_messages: 0,
			min_operations: 0,
			auto_after_messages: 0,
		},
	};
}

export function emptyDialogPair(): DialogPair {
	return { question: "", answer: "" };
}

export function getDefaultForm(): CaseFormData {
	return {
		name: "",
		difficulty: 1,
		time_limit: 20,
		description: "",
		patient_info: { ...DEFAULT_PATIENT },
		chief_complaint: "",
		opening_line: "",
		personality: { ...DEFAULT_PERSONALITY },
		communication_style: "",
		present_illness: "",
		past_history: "",
		medication_history: "",
		allergy_history: "",
		family_history: "",
		social_history: "",
		voice_type: "",
		exam_anchors: {},
		quiz: { ...DEFAULT_QUIZ },
		phases: [],
		deep_background: {},
		example_dialogues: [],
		hidden_info: [],
		required_inquiries: [],
		arrival_mode: "walk",
		red_flags: [],
		vitals: { hr: 0, bp_sys: 0, bp_dia: 0, rr: 0, spo2: 0, temp: 0 },
		consciousness: "alert",
		mews_score: 0,
		triage_category: "",
	};
}

export function parseCaseData(
	data: Record<string, unknown> | CaseBrief,
): CaseFormData {
	const d = data as Record<string, unknown>;
	return {
		name: String(d.name ?? ""),
		difficulty: Number(d.difficulty ?? 1),
		time_limit: Number(d.time_limit ?? 20),
		description: String(d.description ?? ""),
		patient_info: { ...DEFAULT_PATIENT, ...(d.patient_info as Partial<PatientInfo> ?? {}) },
		chief_complaint: String(d.chief_complaint ?? ""),
		opening_line: String(d.opening_line ?? ""),
		personality: { ...DEFAULT_PERSONALITY, ...(d.personality as Partial<PersonalityConfig> ?? {}) },
		communication_style: String(d.communication_style ?? ""),
		present_illness: String(d.present_illness ?? ""),
		past_history: String(d.past_history ?? ""),
		medication_history: String(d.medication_history ?? ""),
		allergy_history: String(d.allergy_history ?? ""),
		family_history: String(d.family_history ?? ""),
		social_history: String(d.social_history ?? ""),
		voice_type: String(d.voice_type ?? ""),
		exam_anchors: (d.exam_anchors as Record<string, string>) ?? {},
		quiz: (d.quiz as QuizFormData) ?? { ...DEFAULT_QUIZ },
		phases: (d.phases as PhaseFormData[]) ?? [],
		deep_background: (d.deep_background as Record<string, string>) ?? {},
		example_dialogues: (d.example_dialogues as DialogPair[]) ?? [],
		hidden_info: (d.hidden_info as string[]) ?? [],
		required_inquiries: (d.required_inquiries as string[]) ?? [],
		arrival_mode: String(d.arrival_mode ?? "walk"),
		red_flags: (d.red_flags as string[]) ?? [],
		vitals: {
			hr: Number((d.vitals as Record<string, number>)?.hr ?? 0),
			bp_sys: Number((d.vitals as Record<string, number>)?.bp_sys ?? 0),
			bp_dia: Number((d.vitals as Record<string, number>)?.bp_dia ?? 0),
			rr: Number((d.vitals as Record<string, number>)?.rr ?? 0),
			spo2: Number((d.vitals as Record<string, number>)?.spo2 ?? 0),
			temp: Number((d.vitals as Record<string, number>)?.temp ?? 0),
		},
		consciousness: String(d.consciousness ?? "alert"),
		mews_score: Number(d.mews_score ?? 0),
		triage_category: String(d.triage_category ?? ""),
	};
}

export function buildCaseData(form: CaseFormData): Record<string, unknown> {
	return {
		name: form.name,
		difficulty: form.difficulty,
		time_limit: form.time_limit,
		description: form.description,
		patient_info: form.patient_info,
		chief_complaint: form.chief_complaint,
		opening_line: form.opening_line,
		personality: form.personality,
		communication_style: form.communication_style,
		present_illness: form.present_illness,
		past_history: form.past_history,
		medication_history: form.medication_history,
		allergy_history: form.allergy_history,
		family_history: form.family_history,
		social_history: form.social_history,
		voice_type: form.voice_type,
		exam_anchors: form.exam_anchors,
		quiz: form.quiz,
		phases: form.phases,
		deep_background: form.deep_background,
		example_dialogues: form.example_dialogues,
		hidden_info: form.hidden_info,
		required_inquiries: form.required_inquiries,
		arrival_mode: form.arrival_mode,
		red_flags: form.red_flags,
		vitals: form.vitals,
		consciousness: form.consciousness,
		mews_score: form.mews_score,
		triage_category: form.triage_category,
	};
}
