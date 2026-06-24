export interface TemplateListItem {
	id: number;
	title: string;
	type: string;
	description?: string;
	is_active: boolean;
	question_count: number;
	response_count: number;
	school_id?: number;
	created_at: string;
	updated_at: string;
}

export interface QuestionItem {
	id: number;
	content: string;
	question_type: string;
	required: boolean;
	sort_order: number;
	options?: string[];
}

export interface TemplateDetail extends TemplateListItem {
	questions: QuestionItem[];
	case_ids: number[];
}

export interface QuestionForm {
	id?: number;
	content: string;
	question_type: string;
	required: boolean;
	sort_order: number;
	options: string[];
}

export interface TemplateForm {
	title: string;
	type: string;
	description: string;
	is_active: boolean;
	questions: QuestionForm[];
}

export interface CaseBrief {
	id: number;
	name: string;
	chief_complaint?: string;
}

export interface AssignForm {
	case_ids: number[];
	is_required: boolean;
	trigger_event: string;
}

export interface ResponseStats {
	template_id: number;
	template_title: string;
	total_assigned: number;
	total_completed: number;
	completion_rate: number;
	questions: QuestionStats[];
}

export interface QuestionStats {
	question_id: number;
	content: string;
	question_type: string;
	response_count: number;
	avg_likert?: number | null;
	choice_distribution?: Record<string, number>;
	text_answers?: string[];
}

export type ViewMode = "list" | "stats";

export const QUESTION_TYPE_LABELS: Record<string, string> = {
	likert_5: "李克特5级量表",
	multiple_choice: "多选题",
	short_text: "简答题",
};

export const QUESTION_TYPE_OPTIONS = [
	{ value: "likert_5", label: "李克特5级量表" },
	{ value: "multiple_choice", label: "多选题" },
	{ value: "short_text", label: "简答题" },
];

export const TYPE_LABEL: Record<string, string> = {
	pre: "前测",
	post: "后测",
};

export const TYPE_OPTIONS = [
	{ value: "", label: "全部" },
	{ value: "pre", label: "前测" },
	{ value: "post", label: "后测" },
];

export const TRIGGER_EVENT_OPTIONS = [
	{ value: "after_training", label: "训练完成后" },
	{ value: "before_training", label: "训练开始前" },
];

export const inputClass =
	"w-full px-2.5 py-1.5 border border-border rounded-md text-sm bg-card text-foreground focus-ring";

export const textareaClass =
	"w-full px-2.5 py-1.5 border border-border rounded-md text-sm bg-card text-foreground focus-ring resize-y";

export function emptyForm(): TemplateForm {
	return {
		title: "",
		type: "pre",
		description: "",
		is_active: true,
		questions: [],
	};
}

export function emptyQuestion(sortOrder: number): QuestionForm {
	return {
		content: "",
		question_type: "likert_5",
		required: true,
		sort_order: sortOrder,
		options: [],
	};
}
