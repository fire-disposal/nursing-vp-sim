export interface TrainingRecordDetail {
	exam_results?: Array<{ type: string; value: string; label?: string; unit?: string }>;
	triage_result?: Record<string, unknown>;
	nursing_record_sheet?: Record<string, string>;
	sheet_data?: Record<string, unknown>;
	quiz?: { questions?: Array<Record<string, unknown>> };
	messages?: Array<{ role: string; content: string }>;
	[key: string]: unknown;
}
