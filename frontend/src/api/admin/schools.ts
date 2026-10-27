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

/** 院徽上传（可选）：入口先归一（剥元数据、限长边、WebP），返回更新后的院校。 */
export const uploadSchoolLogo = (id: number, file: File) => {
	const form = new FormData();
	form.append("file", file);
	return api.post<SchoolItem>(`/admin/schools/${id}/logo` as ApiPath, form);
};

export const deleteSchoolLogo = (id: number) =>
	api.delete<SchoolItem>(`/admin/schools/${id}/logo` as ApiPath);
