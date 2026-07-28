import type { ApiPath } from "../api-path";
import type {
	ApiSecretCreate,
	ApiSecretResponse,
	ApiSecretUpdate,
	HealthCheckItem,
	OkResponse,
	SecretCreateResponse,
	TestAllResultsResponse,
	TestResultItem,
} from "./api-management-types";
import { api } from "../client";

export const fetchSecrets = () =>
	api.get<ApiSecretResponse[]>("/admin/secrets");

export const createSecret = (data: ApiSecretCreate) =>
	api.post<SecretCreateResponse>("/admin/secrets", data);

export const updateSecret = (
	id: number | string,
	data: ApiSecretUpdate,
) => api.put<ApiSecretResponse>(`/admin/secrets/${id}`, data);

export const deleteSecret = (id: number | string) =>
	api.delete<OkResponse>(`/admin/secrets/${id}`);

export const testSecret = (id: number | string) =>
	api.post<TestResultItem>(`/admin/secrets/${id}/test`);

export const testAllSecrets = () =>
	api.post<TestAllResultsResponse>("/admin/secrets/test-all");

export const reloadRouter = () =>
	api.post<OkResponse>("/admin/reload");

export const checkHealth = () =>
	api.get<HealthCheckItem[]>("/admin/health");

export const fetchEnvFallback = () => api.get("/admin/fallback" satisfies ApiPath as string);

export const testEnvFallback = () =>
	api.post<TestResultItem>("/admin/fallback/test");
