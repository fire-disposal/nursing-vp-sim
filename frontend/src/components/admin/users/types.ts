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
}

export interface UserFormValues {
	username: string;
	password: string;
	role: string;
	display_name: string;
	student_id: string;
	memberships: MembershipDraft[];
}

export interface EditUserFormValues {
	display_name: string;
	student_id: string;
	role: string;
	password: string;
	memberships: MembershipDraft[];
}

export interface RoleOption {
	name: string;
	display_name: string;
}
