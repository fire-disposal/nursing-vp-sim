import type { components } from "./api-types.gen";
import { api } from "./axios-instance";

type Schemas = components["schemas"];

export const getQuestionnairesTemplates = (params?: Record<string, unknown>) =>
	api.get<Schemas["PaginatedResponse_QuestionnaireTemplateResponse_"]>(
		"/questionnaires/templates",
		{ params },
	);

export const createQuestionnaireTemplate = (
	data: Schemas["QuestionnaireTemplateCreate"],
) =>
	api.post<Schemas["QuestionnaireTemplateDetailResponse"]>(
		"/questionnaires/templates",
		data,
	);

export const getQuestionnaireTemplate = (id: number) =>
	api.get<Schemas["QuestionnaireTemplateDetailResponse"]>(
		`/questionnaires/templates/${id}`,
	);

export const updateQuestionnaireTemplate = (
	id: number,
	data: Schemas["QuestionnaireTemplateUpdate"],
) =>
	api.put<Schemas["QuestionnaireTemplateDetailResponse"]>(
		`/questionnaires/templates/${id}`,
		data,
	);

export const deleteQuestionnaireTemplate = (id: number) =>
	api.delete<Schemas["OkResponse"]>(`/questionnaires/templates/${id}`);

export const checkQuestionnaire = (params: {
	case_id?: number;
	record_id?: number;
	trigger?: string;
}) =>
	api.get<Schemas["QuestionnaireCheckResponse"]>("/questionnaires/check", {
		params,
	});

export const submitQuestionnaire = (
	data: Schemas["QuestionnaireSubmitRequest"],
) =>
	api.post<Schemas["QuestionnaireResponseItem"]>(
		"/questionnaires/responses",
		data,
	);

export const getQuestionnaireResponses = (
	templateId: number,
	params?: Record<string, unknown>,
) =>
	api.get<Schemas["PaginatedResponse_QuestionnaireResponseItem_"]>(
		`/questionnaires/responses/${templateId}`,
		{ params },
	);

export const getQuestionnaireStats = (templateId: number) =>
	api.get<Schemas["QuestionnaireStatsResponse"]>(
		`/questionnaires/responses/${templateId}/stats`,
	);

export const getMyResponses = (params?: Record<string, unknown>) =>
	api.get<Schemas["PaginatedResponse_QuestionnaireResponseItem_"]>(
		"/questionnaires/my-responses",
		{ params },
	);

export const exportQuestionnaireCSV = (templateId: number) =>
	api.get(`/questionnaires/responses/${templateId}/export`, {
		responseType: "blob",
	});
