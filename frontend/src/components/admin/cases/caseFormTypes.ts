// Type definitions and factory functions used by QuizEditor, PhasesEditor, DialoguesEditor.
// The CaseForm itself now uses CaseEditorState (JSON path) — no longer depends on CaseFormData/parseCaseData/buildCaseData.

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

export function emptyQuizQuestion(): QuizQuestion {
	return { id: `q${Date.now()}`, stem: "", options: [], answer: "", explanation: "" };
}

export function emptyQuizOption(): QuizOption {
	return { key: "", text: "" };
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

export interface DialogPair {
	question: string;
	answer: string;
}

export function emptyDialogPair(): DialogPair {
	return { question: "", answer: "" };
}
