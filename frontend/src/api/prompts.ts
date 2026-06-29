import { api } from "./client";

export interface PromptTemplateResponse {
	id: number;
	purpose: string;
	version: number;
	name: string | null;
	system_prompt: string;
	user_prompt: string | null;
	template_engine: string;
	variables: Record<string, unknown>[] | null;
	is_active: boolean;
	created_by: string | null;
	remark: string | null;
	created_at: string;
	updated_at: string;
	is_builtin: boolean;
	locked: boolean;
}

export interface PromptTemplateCreate {
	purpose: string;
	name?: string | null;
	system_prompt: string;
	user_prompt?: string | null;
	variables?: Record<string, unknown>[] | null;
	created_by?: string | null;
	remark?: string | null;
	activate?: boolean;
}

export interface PromptTemplateUpdate {
	name?: string | null;
	system_prompt?: string | null;
	user_prompt?: string | null;
	variables?: Record<string, unknown>[] | null;
	remark?: string | null;
}

export interface PromptValidateRequest {
	purpose: string;
	system_prompt: string;
	user_prompt?: string | null;
	variables?: Record<string, unknown>[] | null;
}

export interface PromptValidateResponse {
	valid: boolean;
	errors: string[];
	missing_vars: string[];
	warnings: string[];
}

export interface PromptPreviewResponse {
	purpose: string;
	version: number;
	system_prompt_raw: string;
	user_prompt_raw: string | null;
	system_prompt_rendered: string;
	user_prompt_rendered: string | null;
	sample_vars: Record<string, unknown>;
	render_error: string | null;
}

export interface SampleVarsResponse {
	purpose: string;
	vars: Record<string, unknown>;
}

export const fetchPrompts = (purpose?: string) => {
	const params: Record<string, string> = {};
	if (purpose) params.purpose = purpose;
	return api.get<PromptTemplateResponse[]>("/admin/prompts" as string, {
		params,
	});
};

export const createPrompt = (data: PromptTemplateCreate) =>
	api.post<PromptTemplateResponse>("/admin/prompts" as string, data);

export const updatePrompt = (
	id: number | string,
	data: PromptTemplateUpdate,
) => api.put<PromptTemplateResponse>(`/admin/prompts/${id}` as string, data);

export const deletePrompt = (id: number | string) =>
	api.delete<Record<string, unknown>>(`/admin/prompts/${id}` as string);

export const activatePrompt = (id: number | string, purpose?: string) =>
	api.post<PromptTemplateResponse>(
		`/admin/prompts/${id}/activate${purpose ? `?purpose=${encodeURIComponent(purpose)}` : ""}` as string,
	);

export const validatePrompt = (data: PromptValidateRequest) =>
	api.post<PromptValidateResponse>("/admin/prompts/validate" as string, data);

export const reloadPrompts = () =>
	api.post<Record<string, unknown>>("/admin/prompts/reload" as string);

export const previewActivePrompt = (purpose: string) =>
	api.get<PromptPreviewResponse>("/admin/prompts/active/preview" as string, {
		params: { purpose },
	});

export const fetchSampleVars = (purpose: string) =>
	api.get<SampleVarsResponse>("/admin/prompts/sample-vars" as string, {
		params: { purpose },
	});
