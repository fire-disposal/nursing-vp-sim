import type { components } from "../api-types.gen";
import { api } from "../client";

import type { ApiPath } from "../api-path";

type Schemas = components["schemas"];

export const fetchSecrets = () =>
	api.get<Schemas["ApiSecretResponse"][]>("/admin/secrets");

export const createSecret = (data: Schemas["ApiSecretCreate"]) =>
	api.post<Schemas["SecretCreateResponse"]>("/admin/secrets", data);

export const updateSecret = (
	id: number | string,
	data: Schemas["ApiSecretUpdate"],
) => api.put<Schemas["ApiSecretResponse"]>(`/admin/secrets/${id}`, data);

export const deleteSecret = (id: number | string) =>
	api.delete<Schemas["OkResponse"]>(`/admin/secrets/${id}`);

export const fetchConfigs = (purpose?: string) => {
	const params: Record<string, string> = {};
	if (purpose) params.purpose = purpose;
	return api.get<Schemas["LLMConfigResponse"][]>("/admin/configs", {
		params,
	});
};

export const createConfig = (data: Schemas["LLMConfigCreate"]) =>
	api.post<Schemas["ConfigCreateResponse"]>("/admin/configs", data);

export const updateConfig = (
	id: number | string,
	data: Schemas["LLMConfigUpdate"],
) => api.put<Schemas["LLMConfigResponse"]>(`/admin/configs/${id}`, data);

export const deleteConfig = (id: number | string) =>
	api.delete<Schemas["OkResponse"]>(`/admin/configs/${id}`);

export const toggleConfig = (id: number | string) =>
	api.post<Schemas["ToggleStatusResponse"]>(`/admin/configs/${id}/toggle`);

export const resetConfig = (id: number | string) =>
	api.post<Schemas["OkResponse"]>(`/admin/configs/${id}/reset`);

export const testConfig = (id: number | string) =>
	api.post<Schemas["TestResultItem"]>(`/admin/configs/${id}/test`);

export const testAllConfigs = () =>
	api.post<Schemas["TestAllResultsResponse"]>("/admin/configs/test-all");

export const reloadRouter = () =>
	api.post<Schemas["OkResponse"]>("/admin/reload");

export const checkHealth = () =>
	api.get<Schemas["HealthCheckItem"][]>("/admin/health");

export const fetchEnvFallback = () => api.get("/admin/fallback" satisfies ApiPath as string);

export const testEnvFallback = () =>
	api.post<Schemas["TestResultItem"]>("/admin/fallback/test");
