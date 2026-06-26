import type { ApiPath } from "./api-path";
import type { components } from "./api-types.gen";
import { api } from "./client";

type Schemas = components["schemas"];

export const fetchPrompts = (purpose?: string) => {
	const params: Record<string, string> = {};
	if (purpose) params.purpose = purpose;
	return api.get<Schemas["PromptTemplateResponse"][]>("/admin/prompts" satisfies ApiPath as string, {
		params,
	});
};

export const createPrompt = (data: Schemas["PromptTemplateCreate"]) =>
	api.post<Schemas["PromptTemplateResponse"]>("/admin/prompts" satisfies ApiPath as string, data);

export const updatePrompt = (
	id: number | string,
	data: Schemas["PromptTemplateUpdate"],
) => api.put<Schemas["PromptTemplateResponse"]>(`/admin/prompts/${id}` as ApiPath, data);

export const deletePrompt = (id: number | string) =>
	api.delete<Schemas["OkResponse"]>(`/admin/prompts/${id}` as ApiPath);

export const activatePrompt = (id: number | string, purpose?: string) =>
	api.post<Schemas["PromptTemplateResponse"]>(
		`/admin/prompts/${id}/activate${purpose ? `?purpose=${encodeURIComponent(purpose)}` : ""}` as ApiPath,
	);

export const validatePrompt = (data: Schemas["PromptValidateRequest"]) =>
	api.post<Schemas["PromptValidateResponse"]>("/admin/prompts/validate" satisfies ApiPath as string, data);

export const reloadPrompts = () =>
	api.post<Schemas["OkResponse"]>("/admin/prompts/reload" satisfies ApiPath as string);

export const previewActivePrompt = (purpose: string) =>
	api.get<Schemas["PromptPreviewResponse"]>("/admin/prompts/active/preview" satisfies ApiPath as string, {
		params: { purpose },
	});

export const fetchSampleVars = (purpose: string) =>
	api.get<Schemas["SampleVarsResponse"]>("/admin/prompts/sample-vars" satisfies ApiPath as string, {
		params: { purpose },
	});
