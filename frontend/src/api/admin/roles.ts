import type { ApiPath } from "../api-path";
import type { components } from "../api-types.gen";
import { api } from "../client";

type Schemas = components["schemas"];

export const getRoles = (search?: string) =>
	api.get<Schemas["RoleResponse"][]>(
		"/admin/roles" satisfies ApiPath as string,
		{ params: { search: search || undefined } },
	);

export const createRole = (data: Schemas["RoleCreateRequest"]) =>
	api.post<Schemas["RoleResponse"]>(
		"/admin/roles" satisfies ApiPath as string,
		data,
	);

export const updateRole = (id: number, data: Schemas["RoleUpdateRequest"]) =>
	api.put<Schemas["RoleResponse"]>(
		`/admin/roles/${id}` as ApiPath,
		data,
	);

export const deleteRole = (id: number) =>
	api.delete<Schemas["DeleteResponse"]>(`/admin/roles/${id}` as ApiPath);
