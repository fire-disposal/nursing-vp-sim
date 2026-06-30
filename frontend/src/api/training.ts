import type { TrainingTypeInfo } from "@/training/types";
import type { ApiPath } from "./api-path";
import type { components } from "./api-types.gen";
import { api } from "./client";

type Schemas = components["schemas"];

export const getProfiles = () =>
  api.get<{ items: TrainingTypeInfo[] }>("/profiles" satisfies ApiPath as string).then((r) => r.data.items);

export const endTraining = (recordId: number | string, signal?: AbortSignal) =>
	api.post<Schemas["ScoringTriggerResponse"]>(
		`/training/${recordId}/end` as ApiPath,
		null,
		{ signal },
	);

export const retryScoring = (recordId: number | string) =>
	api.post<Schemas["ScoringTriggerResponse"]>(
		`/training/${recordId}/retry-scoring` as ApiPath,
	);

export const getRecords = (params: Record<string, unknown> = {}) =>
	api.get<Schemas["PaginatedResponse_TrainingRecordBrief_"]>(
		"/training/records" satisfies ApiPath as string,
		{ params },
	);

export const deleteRecord = (id: number | string) =>
	api.delete<Schemas["DeleteResponse"]>(`/training/records/${id}` as ApiPath);

export const getRecordDetail = (id: number | string) =>
	api.get<Schemas["TrainingRecordDetail"]>(`/training/records/${id}` as ApiPath);

export const getScoreReview = (recordId: number | string) =>
	api.get<Schemas["ScoreReviewResponse"]>(
		`/training/records/${recordId}/review` as ApiPath,
	);

export const submitScoreReview = (
	recordId: number | string,
	data: Schemas["ScoreReviewRequest"],
) =>
	api.post<Schemas["ScoreReviewResponse"]>(
		`/training/records/${recordId}/review` as ApiPath,
		data,
	);

export const performExam = (recordId: number | string, opType: string) =>
	api.post<Schemas["ExamOperationResponse"]>(
		`/training/${recordId}/exam/${opType}` as ApiPath,
	);

// TODO: use generated types after api:spec is fixed
interface TriageSubmitRequest {
	mews_score: number;
	category: string;
	department: string;
	notes: string;
}

interface TriageSubmitResponse {
	message: string;
	record_id: number;
	triage_result?: Record<string, unknown>;
}

export const submitTriage = (recordId: number, data: TriageSubmitRequest) =>
	api
		.post<TriageSubmitResponse>(`/api/triage/${recordId}/submit` as ApiPath, data)
		.then((r) => r.data);
