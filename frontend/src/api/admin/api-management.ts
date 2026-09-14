import type { ApiPath } from "../api-path";
import type { components } from "../api-types.gen";
import { api } from "../client";

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

export const testSecret = (id: number | string) =>
	api.post<Schemas["TestResultItem"]>(`/admin/secrets/${id}/test`);

export const testAllSecrets = () =>
	api.post<Schemas["TestAllResultsResponse"]>("/admin/secrets/test-all");

export const reloadRouter = () =>
	api.post<Schemas["OkResponse"]>("/admin/reload");

export const checkHealth = () =>
	api.get<Schemas["HealthCheckItem"][]>("/admin/health");

export const fetchEnvFallback = () => api.get("/admin/fallback" satisfies ApiPath as string);

export const testEnvFallback = () =>
	api.post<Schemas["TestResultItem"]>("/admin/fallback/test");
