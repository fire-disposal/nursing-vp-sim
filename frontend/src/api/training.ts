import type { TrainingTypeInfo } from "@/components/training/types";
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

export const retryScoring = (recordId: number | string, params?: { force?: boolean }) =>
	api.post<Schemas["ScoringTriggerResponse"]>(
		`/training/${recordId}/retry-scoring` as ApiPath,
		null,
		{ params },
	);

export interface GetRecordsParams {
	limit?: number;
	offset?: number;
	status?: string;
	date_from?: string;
	date_to?: string;
	student_name?: string;
	case_id?: number;
	class_id?: number;
	training_type?: string;
	exclude_is_test?: boolean;
	user_id?: number;
}

export const getRecords = (params: GetRecordsParams = {}) =>
	api.get<Schemas["PaginatedResponse_TrainingRecordBrief_"]>(
		"/training/records" satisfies ApiPath as string,
		{ params: params as Record<string, unknown> },
	);

export const deleteRecord = (id: number | string) =>
	api.delete<Schemas["DeleteResponse"]>(`/training/records/${id}` as ApiPath);

export const getRecordDetail = (id: number | string) =>
	api.get<Schemas["TrainingRecordDetail"]>(`/training/records/${id}` as ApiPath);

export const pauseTraining = (id: number | string) =>
	api.post<Schemas["OkResponse"]>(`/training/records/${id}/pause` as ApiPath, {});

export const resumeTraining = (id: number | string) =>
	api.post<Schemas["OkResponse"]>(`/training/records/${id}/resume` as ApiPath, {});

export const submitScoreReview = (
	recordId: number | string,
	data: Schemas["ScoreReviewRequest"],
) =>
	api.post<Schemas["ScoreReviewResponse"]>(
		`/training/records/${recordId}/review` as ApiPath,
		data,
	);


export const abandonRecord = (recordId: number | string) =>
	api.put<Schemas["OkResponse"]>(`/training/records/${recordId}/abandon` as ApiPath);

export const triggerInitiative = (recordId: number) =>
	api.post<components["schemas"]["InitiativeTriggerResponse"]>(
		`/training/${recordId}/initiative/trigger` as ApiPath,
	);

export interface ToolCommandBody {
	cmd: string;
	params: Record<string, unknown>;
	idem_key: string;
	revision: number | null;
}

export interface ToolCommandResult {
	ok: boolean;
	data: Record<string, unknown>;
	scene?: Record<string, unknown> | null;
	error: string;
	revision: number;
}

/** 工具指令面（Phase 2.5）：HTTP 请求/响应替代 WS tool 通道 */
export const postToolCommand = (recordId: number | string, body: ToolCommandBody) =>
	api.post<ToolCommandResult>(`/training/${recordId}/tools` as ApiPath, body).then((r) => r.data);

export interface EmotionEventItem {
	turn_id?: string | null;
	event_type: string;
	confidence?: number | null;
	evidence?: string | null;
	delta?: Record<string, number>;
	after_state: { trust: number; anxiety: number; irritation: number; cooperation: number };
}

/** 情绪事件历史（批次 A-3 轨迹图数据源） */
export const getEmotionEvents = (recordId: number | string) =>
	api
		.get<{ events: EmotionEventItem[] }>(`/training/${recordId}/emotion-events` as ApiPath)
		.then((r) => r.data.events);
