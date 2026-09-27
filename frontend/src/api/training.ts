import type { ApiPath } from "./api-path";
import type { components } from "./api-types.gen";
import { api } from "./client";
import useAuthStore from "@/stores/authStore";

type Schemas = components["schemas"];

/**
 * `POST /training/{id}/end` 请求体：原子「提交护理评估并完成」。
 *
 * `submit_nursing_record` 打开服务端的提交+校验：同一事务里先落盘
 * `nursing_record_sheet`（可选）并冻结提交版本，再校验完成前置条件。
 * 前置条件不满足时服务端返回 409，`detail` 携带 `{message, code, missing_fields}`。
 */
export interface EndTrainingBody {
	submit_nursing_record?: boolean;
	nursing_record_sheet?: Record<string, string> | null;
}

export const endTraining = (recordId: number | string, body?: EndTrainingBody | null, signal?: AbortSignal) =>
	api.post<Schemas["ScoringTriggerResponse"]>(
		`/training/${recordId}/end` as ApiPath,
		body ?? null,
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

/** 再练习类型：同例纠正 / 迁移变式（服务端解析目标病例，请求只表达意图） */
export type PracticeKind = "remediation" | "transfer";

/**
 * 复盘后的再练习（docs/19 §五）。
 *
 * 目标病例、钉住的 revision 与「内容是否已更新」全由服务端解析；不可用时返回
 * 409 + `{code, kind, message}`（前端据此提示，不猜原因、不自行拼 case_id）。
 */
export const startPractice = (sourceRecordId: number | string, kind: PracticeKind) =>
	api.post<Schemas["TrainingStartResponse"]>("/training/start-practice" as ApiPath, {
		source_record_id: Number(sourceRecordId),
		kind,
	} satisfies Schemas["StartPracticeRequest"]);

export const pauseTraining = (
	id: number | string,
	options?: { questionnaire?: boolean },
) =>
	api.post<Schemas["OkResponse"]>(`/training/records/${id}/pause` as ApiPath, {}, {
		params: options?.questionnaire ? { questionnaire: true } : undefined,
	});

export const resumeTraining = (id: number | string) =>
	api.post<Schemas["OkResponse"]>(`/training/records/${id}/resume` as ApiPath, {});

/**
 * 离页暂停（pagehide / unload 路径）—— **必须带 Authorization**。
 *
 * `navigator.sendBeacon` 无法附加请求头，服务端 `get_current_user` 必然拒绝：
 * 旧实现既没有真正暂停，UI 却已宣称「已暂停」。这里改用 `fetch(..., {keepalive:true})`，
 * token 取自与 axios 客户端同一个来源（authStore），请求在页面卸载后仍会发出。
 *
 * 返回服务端 `OkResponse.message`（如「训练已暂停」/「独立考核离开后仍继续计时」），
 * 调用方据此判断服务端是否真的暂停；失败抛错，由调用方如实说明而不是假设成功。
 */
export async function pauseTrainingOnHide(
	id: number | string,
	options?: { questionnaire?: boolean },
): Promise<string> {
	const token = useAuthStore.getState().token;
	const headers: Record<string, string> = { "Content-Type": "application/json" };
	if (token) headers.Authorization = `Bearer ${token}`;
	const query = options?.questionnaire ? "?questionnaire=true" : "";
	const response = await fetch(`/api/training/records/${id}/pause${query}`, {
		method: "POST",
		headers,
		body: "{}",
		keepalive: true,
		credentials: "same-origin",
	});
	if (!response.ok) {
		throw new Error(`暂停请求被服务端拒绝（HTTP ${response.status}）`);
	}
	const payload = (await response.json()) as { message?: string };
	return payload.message ?? "";
}

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

/** 情绪事件历史（批次 A-3 轨迹图数据源） — 路径取自生成类型，写错段名会在编译期失败 */
const EMOTION_EVENTS_PATH = "/training/records/{record_id}/emotion-events" satisfies ApiPath;

export const getEmotionEvents = (recordId: number | string) =>
	api
		.get<{ events: EmotionEventItem[] }>(EMOTION_EVENTS_PATH.replace("{record_id}", String(recordId)))
		.then((r) => r.data.events);
