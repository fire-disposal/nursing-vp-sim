import type { ApiPath } from "./api-path";
import type { components } from "./api-types.gen";
import { api } from "./axios-instance";

type Schemas = components["schemas"];

export const endTraining = (recordId: number | string, signal?: AbortSignal) =>
	api.post<Schemas["ScoringTriggerResponse"]>(
		`/training/${recordId}/end`,
		null,
		{ signal },
	);

export const retryScoring = (recordId: number | string) =>
	api.post<Schemas["ScoringTriggerResponse"]>(
		`/training/${recordId}/retry-scoring`,
	);

export const getRecords = (params: Record<string, unknown> = {}) =>
	api.get<Schemas["PaginatedResponse_TrainingRecordBrief_"]>(
		"/training/records" satisfies ApiPath as string,
		{ params },
	);

export const deleteRecord = (id: number | string) =>
	api.delete<Schemas["DeleteResponse"]>(`/training/records/${id}`);

export const getRecordDetail = (id: number | string) =>
	api.get<Schemas["TrainingRecordDetail"]>(`/training/records/${id}`);

export const getScoreReview = (recordId: number | string) =>
	api.get<Schemas["ScoreReviewResponse"]>(
		`/training/records/${recordId}/review`,
	);

export const submitScoreReview = (
	recordId: number | string,
	data: Schemas["ScoreReviewRequest"],
) =>
	api.post<Schemas["ScoreReviewResponse"]>(
		`/training/records/${recordId}/review`,
		data,
	);

export const getSessionConfigs = () =>
	api.get<Record<string, unknown>[]>("/training/configs");
