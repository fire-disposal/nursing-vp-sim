import { casePublishGateErrorSchema } from "@/schemas/case";
import type { ApiPath } from "./api-path";
import type { components } from "./api-types.gen";
import { api } from "./client";

type Schemas = components["schemas"];

const CASE_DETAIL = "/cases/{case_id}" satisfies ApiPath;

export const getCases = (params: Record<string, unknown> = {}) =>
	api.get<Schemas["PaginatedResponse_CaseBrief_"]>(
		"/cases" satisfies ApiPath as string,
		{ params },
	);

export const getCaseDetail = (id: number | string) =>
	api.get<Schemas["CaseDetail"]>(CASE_DETAIL.replace("{case_id}", String(id)));

export const startTraining = (
	caseId: number | string,
	features?: Record<string, boolean> | null,
	timeLimitMinutes?: number | null,
) =>
	api.post<Schemas["TrainingStartResponse"]>(
		"/training/start" satisfies ApiPath as string,
		{
			case_id: caseId,
			...(features ? { features } : {}),
			...(timeLimitMinutes != null ? { time_limit_minutes: timeLimitMinutes } : {}),
		},
	);

/** 盲盒训练：后端随机抽取开放病例，隐藏标题与引导内容。 */
export const startBlindBox = () =>
	api.post<Schemas["TrainingStartResponse"]>(
		"/training/start-blind-box" satisfies ApiPath as string,
		{},
	);

export const getManageCases = (params: Record<string, unknown> = {}) =>
	api.get<Schemas["PaginatedResponse_CaseManageItem_"]>(
		"/cases/manage/list" satisfies ApiPath as string,
		{ params },
	);

export const createCase = (data: Schemas["CaseCreateRequest"]) =>
	api.post<Schemas["CaseManageItem"]>(
		"/cases" satisfies ApiPath as string,
		data,
	);

export const updateCase = (
	id: number | string,
	data: Schemas["CaseUpdateRequest"],
) =>
	api.put<Schemas["CaseManageItem"]>(
		CASE_DETAIL.replace("{case_id}", String(id)),
		data,
	);

export const deleteCase = (id: number | string) =>
	api.delete<Schemas["DeleteResponse"]>(
		CASE_DETAIL.replace("{case_id}", String(id)),
	);

export const generateCase = (data: Schemas["CaseGenerateRequest"]) =>
	api.post<Schemas["CaseGenerateResponse"]>(
		"/cases/generate" satisfies ApiPath as string,
		data,
	);

export const toggleCaseOpen = (id: number | string, open: boolean) =>
	api.put<Schemas["CaseManageItem"]>(
		`/cases/${id}/open?open=${open}`,
	);

// ── 生命周期（docs/15 §六）：发布门禁 / 版本 ────────────────────────────────

/** 发布门禁预览：字段级 error/warning（与 CI 病例审计同一份规则）。 */
export const getCaseValidation = (id: number | string) =>
	api.get<Schemas["CaseValidationReport"]>(`/cases/${id}/validation`);

/** 发布：门禁通过才落版本；有 error 时 422。 */
export const publishCase = (id: number | string) =>
	api.post<Schemas["CasePublishResponse"]>(`/cases/${id}/publish`);

/** 归档：只阻止新使用，历史版本与既有训练保留。 */
export const archiveCase = (id: number | string) =>
	api.post<Schemas["CaseManageItem"]>(`/cases/${id}/archive`);

/** 版本历史（新→旧）：已发布版本不可改，编辑产生新版本。 */
export const getCaseRevisions = (id: number | string) =>
	api.get<Schemas["CaseRevisionItem"][]>(`/cases/${id}/revisions`);

/**
 * 从发布/编辑失败（422）的异常里取出字段级门禁报告。
 * 非门禁失败（网络、409、普通 422 校验）解析失败即返回 null，交由 apiError 通用展示。
 */
export function publishReportOf(err: unknown): Schemas["CaseValidationReport"] | null {
	const parsed = casePublishGateErrorSchema.safeParse(err);
	return parsed.success ? parsed.data.response.data.detail.report : null;
}
