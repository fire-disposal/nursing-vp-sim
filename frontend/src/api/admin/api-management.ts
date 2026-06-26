import type { components } from "../api-types.gen";
import { api } from "../client";

type Schemas = components["schemas"];

export const fetchSecrets = () =>
	api.get<Schemas["ApiSecretResponse"][]>("/admin/api/secrets");

export const createSecret = (data: Schemas["ApiSecretCreate"]) =>
	api.post<Schemas["SecretCreateResponse"]>("/admin/api/secrets", data);

export const updateSecret = (
	id: number | string,
	data: Schemas["ApiSecretUpdate"],
) => api.put<Schemas["ApiSecretResponse"]>(`/admin/api/secrets/${id}`, data);

export const deleteSecret = (id: number | string) =>
	api.delete<Schemas["OkResponse"]>(`/admin/api/secrets/${id}`);

export const fetchConfigs = (purpose?: string) => {
	const params: Record<string, string> = {};
	if (purpose) params.purpose = purpose;
	return api.get<Schemas["LLMConfigResponse"][]>("/admin/api/configs", {
		params,
	});
};

export const createConfig = (data: Schemas["LLMConfigCreate"]) =>
	api.post<Schemas["ConfigCreateResponse"]>("/admin/api/configs", data);

export const updateConfig = (
	id: number | string,
	data: Schemas["LLMConfigUpdate"],
) => api.put<Schemas["LLMConfigResponse"]>(`/admin/api/configs/${id}`, data);

export const deleteConfig = (id: number | string) =>
	api.delete<Schemas["OkResponse"]>(`/admin/api/configs/${id}`);

export const toggleConfig = (id: number | string) =>
	api.post<Schemas["ToggleStatusResponse"]>(`/admin/api/configs/${id}/toggle`);

export const resetConfig = (id: number | string) =>
	api.post<Schemas["OkResponse"]>(`/admin/api/configs/${id}/reset`);

export const testConfig = (id: number | string) =>
	api.post<Schemas["TestResultItem"]>(`/admin/api/configs/${id}/test`);

export const testAllConfigs = () =>
	api.post<Schemas["TestAllResultsResponse"]>("/admin/api/configs/test-all");

export const reloadRouter = () =>
	api.post<Schemas["OkResponse"]>("/admin/api/reload");

export const checkHealth = () =>
	api.get<Schemas["HealthCheckItem"][]>("/admin/api/health");

export const fetchEnvFallback = () => api.get("/admin/api/fallback");

export const testEnvFallback = () =>
	api.post<Schemas["TestResultItem"]>("/admin/api/fallback/test");
