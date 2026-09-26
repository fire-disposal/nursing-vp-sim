// Type definitions and factory functions used by QuizEditor.
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
