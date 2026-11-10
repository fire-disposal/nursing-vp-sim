import type { ApiPath } from "./api-path";
import type { components } from "./api-types.gen";
import { api } from "./client";

type Schemas = components["schemas"];

export type QuestionnaireAnswerItem = Schemas["QuestionnaireAnswerItem"];
export type QuestionnaireResponseItem = Schemas["QuestionnaireResponseItem"];
export type PaginatedQuestionnaireResponses = Schemas["PaginatedResponse_QuestionnaireResponseItem_"];

export interface QuestionnaireResponseListParams {
	offset?: number;
	limit?: number;
	/** 提交状态：completed / pending。 */
	status?: string;
	/** 触发时点：before_training / after_scoring。 */
	trigger_event?: string;
	/** 学生姓名模糊搜索。 */
	search?: string;
}

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

/** 答卷列表（真实分页 + 服务端筛选）。收窄到本校/本人任教班由后端完成。 */
export const getQuestionnaireResponses = (
	templateId: number,
	params: QuestionnaireResponseListParams,
) =>
	api.get<PaginatedQuestionnaireResponses>(
		`/questionnaires/responses/${templateId}`,
		{ params },
	);

/**
 * 单份答卷详情。越权（他校/他人名下）由后端返回 404，
 * 前端照常走错误态——不把它降级成「空答卷」。
 */
export const getQuestionnaireResponse = (
	templateId: number,
	responseId: number,
) =>
	api.get<QuestionnaireResponseItem>(
		`/questionnaires/responses/${templateId}/${responseId}`,
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
