import type { components } from "@/api/api-types.gen";

export type Schemas = components["schemas"];

/**
 * 用户简档。`role`/`role_display_name` 已随角色退场删除（权限只来自视角），
 * 故不能直接用生成物里的 `UserBrief` —— `api-types.gen.ts` 仍是旧契约，
 * 重生成后这里的局部声明可以整体换回 `Schemas["UserBrief"]`。
 */
export type UserBrief = Omit<Schemas["UserBrief"], "role" | "role_display_name">;

/** 批量导入的一行（与后端 `BatchUserItem` 同形，`personas` 取代 `role`）。 */
export type BatchUser = Omit<Schemas["BatchUserItem"], "role"> & { personas: string[] };

/** 注册请求体（`personas` 取代 `role`）。 */
export type RegisterPayload = Omit<Schemas["RegisterRequest"], "role"> & { personas: string[] };

/** 编辑请求体（`personas` 取代 `role`；省略 = 不修改）。 */
export type UpdatePayload = Omit<Schemas["UserUpdateRequest"], "role"> & { personas?: string[] };

export type BatchCreateResult = Schemas["BatchCreateResult"];
export type BatchPreviewResult = Schemas["BatchPreviewResult"];

/** 表单里的一行班级归属（提交时整体替换用户的 memberships）。 */
export interface MembershipDraft {
	class_id: string;
	member_role: "student" | "teacher";
}

export interface UserFormValues {
	username: string;
	password: string;
	personas: string[];
	display_name: string;
	student_id: string;
	/** 所属单位（院校 id 的字符串形式）；平台账号为空串。 */
	school_id: string;
	memberships: MembershipDraft[];
}

export interface EditUserFormValues {
	/** 登录用户名（可改）：省略 = 不修改。 */
	username?: string;
	display_name: string;
	student_id: string;
	personas: string[];
	password: string;
	/** 所属单位（院校 id 的字符串形式）；省略 = 不修改。 */
	school_id: string;
	memberships: MembershipDraft[];
}

/** 视角下拉/多选的选项（取自 `/admin/personas`，失败时回落静态预设）。 */
export interface PersonaOption {
	value: string;
	label: string;
}

/** 院校（单位）选项：用户表单只需要 id 与名称。 */
export interface SchoolOption {
	id: number;
	name: string;
}
