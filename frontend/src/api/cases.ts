import type { components } from "./api-types.gen";
import type { ApiPath } from "./api-path";
import { api } from "./axios-instance";

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
	practiceId?: number | null,
) =>
	api.post<Schemas["TrainingStartResponse"]>(
		"/training/start" satisfies ApiPath as string,
		{
			case_id: caseId,
			...(practiceId ? { practice_id: practiceId } : {}),
		},
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
