import type { components } from "@/api/api-types.gen";

/** 班级（`ClassResponse`）：cohort_label 取代年级归属。 */
export type ClassItem = components["schemas"]["ClassResponse"];
/** 班级成员花名册项。 */
export type ClassMemberItem = components["schemas"]["ClassMemberItem"];
/** 用户的班级归属（单用户多班级，一个用户可有多条）。 */
export type UserMembershipItem = components["schemas"]["UserMembershipItem"];
export type MemberRole = "student" | "teacher";

export interface User {
	user_id: number;
	username?: string;
	role: string;
	role_display_name: string;
	display_name: string;
	student_id?: string | null;
	gender?: string | null;
	avatar?: string | null;
	/** 完整班级归属集合，不存在主班级概念。 */
	memberships: UserMembershipItem[];
}

export interface RoleItem {
	id: number;
	name: string;
	display_name: string;
	is_system: boolean;
	permissions: string[];
	user_count: number;
}

export interface AuthState {
	user: User | null;
	token: string | null;
	login: (username: string, password: string) => Promise<User>;
	refreshUser: () => Promise<void>;
	logout: () => void;
	permissions: string[];
}
