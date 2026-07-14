import type { components } from "@/api/api-types.gen";

export type Schemas = components["schemas"];
export type UserBrief = Schemas["UserBrief"];
export type BatchCreateResult = Schemas["BatchCreateResult"];

export interface BatchUser {
	username: string;
	password: string;
	display_name: string;
	role: string;
	student_id: string | null;
	class_id: number | null;
	class_name?: string | null;
}

export interface UserFormValues {
	username: string;
	password: string;
	role: string;
	display_name: string;
	student_id: string;
	class_id: string;
}

export interface EditUserFormValues {
	display_name: string;
	student_id: string;
	role: string;
	password: string;
	class_id: string;
}

export interface RoleOption {
	name: string;
	display_name: string;
}
