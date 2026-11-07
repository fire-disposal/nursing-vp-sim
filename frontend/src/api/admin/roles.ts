import type { ApiPath } from "../api-path";
import type { components } from "../api-types.gen";
import { api } from "../client";

type Schemas = components["schemas"];

/**
 * 账号类型（角色）列表：**只作为用户表单的可选项**（学生/教师/管理员…），
 * 不再承载权限语义 —— 权限由视角（persona）授予。角色 CRUD 已从产品面移除。
 */
export const getRoles = (search?: string) =>
	api.get<Schemas["RoleResponse"][]>(
		"/admin/roles" satisfies ApiPath as string,
		{ params: { search: search || undefined } },
	);
