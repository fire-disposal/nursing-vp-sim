import type { ApiPath } from "../api-path";
import type { components } from "../api-types.gen";
import { api } from "../axios-instance";

type Schemas = components["schemas"];

export const getSchools = (params: Record<string, unknown> = {}) =>
	api.get<Schemas["PaginatedResponse_SchoolResponse_"]>(
		"/admin/schools" satisfies ApiPath as string,
		{ params },
	);

export const createSchool = (data: Schemas["SchoolCreate"]) =>
	api.post<Schemas["SchoolResponse"]>(
		"/admin/schools" satisfies ApiPath as string,
		data,
	);

export const deleteSchool = (id: number) =>
	api.delete<Schemas["DeleteResponse"]>(`/admin/schools/${id}`);
