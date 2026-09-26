import type { ApiPath } from "./api-path";
import type { components } from "./api-types.gen";
import { api } from "./client";

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
	trigger?: Schemas["QuestionnaireTrigger"];
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

export const getQuestionnaireStats = (templateId: number) =>
	api.get<Schemas["QuestionnaireStatsResponse"]>(
		`/questionnaires/responses/${templateId}/stats`,
	);


export const exportQuestionnaireCSV = (templateId: number) =>
	api.post(`/questionnaires/responses/${templateId}/export` as ApiPath, null, { responseType: "blob" });

export const assignCaseQuestionnaire = (
	templateId: number,
	payload: {
		case_ids: number[];
		is_required: boolean;
		trigger_event: Schemas["QuestionnaireTrigger"];
	},
) =>
	api.put<Schemas["OkResponse"]>(
		`/questionnaires/templates/${templateId}/case-assignments`,
		payload,
	);

