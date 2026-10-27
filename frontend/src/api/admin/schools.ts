import type { ApiPath } from "../api-path";
import type { components } from "../api-types.gen";
import { api } from "../client";

type Schemas = components["schemas"];

export type SchoolItem = Schemas["SchoolResponse"];

/** 院校列表（平台级，需 `school_manage`）。 */
export const getSchools = () =>
	api.get<SchoolItem[]>("/admin/schools" satisfies ApiPath as string);

export const createSchool = (data: Schemas["SchoolCreate"]) =>
	api.post<SchoolItem>("/admin/schools" satisfies ApiPath as string, data);

export const updateSchool = (id: number, data: Schemas["SchoolUpdate"]) =>
	api.put<SchoolItem>(`/admin/schools/${id}` as ApiPath, data);

export const deleteSchool = (id: number) =>
	api.delete<Schemas["DeleteSchoolResponse"]>(
		`/admin/schools/${id}` as ApiPath,
	);
