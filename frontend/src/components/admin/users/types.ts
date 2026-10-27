import type { components } from "@/api/api-types.gen";

export type Schemas = components["schemas"];
export type UserBrief = Schemas["UserBrief"];
export type BatchCreateResult = Schemas["BatchCreateResult"];

/** 表单里的一行班级归属（提交时整体替换用户的 memberships）。 */
export interface MembershipDraft {
	class_id: string;
	member_role: "student" | "teacher";
}

export interface BatchUser {
	username: string;
	password: string;
	display_name: string;
	role: string;
	student_id: string | null;
	class_id: number | null;
	class_name?: string | null;
	cohort_label?: string | null;
	/** 「学校」列：院校名称（平台角色没填班级时必填；院校管理员可留空） */
	school_name?: string | null;
}

export interface UserFormValues {
	username: string;
	password: string;
	role: string;
	display_name: string;
	student_id: string;
	/** 所属单位（院校 id 的字符串形式）；平台账号为空串。 */
	school_id: string;
	memberships: MembershipDraft[];
}

export interface EditUserFormValues {
	display_name: string;
	student_id: string;
	role: string;
	password: string;
	/** 所属单位（院校 id 的字符串形式）；省略 = 不修改。 */
	school_id: string;
	memberships: MembershipDraft[];
}

export interface RoleOption {
	name: string;
	display_name: string;
}

/** 院校（单位）选项：用户表单只需要 id 与名称。 */
export interface SchoolOption {
	id: number;
	name: string;
}
