import type { components } from "./api-types.gen";
import { api } from "./axios-instance";

type Schemas = components["schemas"];

export const getCases = (params: Record<string, unknown> = {}) =>
	api.get<Schemas["PaginatedResponse_CaseBrief_"]>("/cases", { params });

export const getCaseDetail = (id: number | string) =>
	api.get<Schemas["CaseDetail"]>(`/cases/${id}`);

export const startTraining = (
	caseId: number | string,
	practiceId?: number | null,
) =>
	api.post<Schemas["TrainingStartResponse"]>("/training/start", {
		case_id: caseId,
		...(practiceId ? { practice_id: practiceId } : {}),
	});

export const getManageCases = (params: Record<string, unknown> = {}) =>
	api.get<Schemas["PaginatedResponse_CaseManageItem_"]>("/cases/manage/list", {
		params,
	});

export const createCase = (data: Schemas["CaseCreateRequest"]) =>
	api.post<Schemas["CaseManageItem"]>("/cases", data);

export const updateCase = (
	id: number | string,
	data: Schemas["CaseUpdateRequest"],
) => api.put<Schemas["CaseManageItem"]>(`/cases/${id}`, data);

export const deleteCase = (id: number | string) =>
	api.delete<Schemas["DeleteResponse"]>(`/cases/${id}`);

export const generateCase = (data: Schemas["CaseGenerateRequest"]) =>
	api.post<Schemas["CaseGenerateResponse"]>("/cases/generate", data);
