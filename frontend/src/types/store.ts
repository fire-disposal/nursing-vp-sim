import type { components } from "@/api/api-types.gen";

/** 班级（`ClassResponse`）：cohort_label 取代年级归属。 */
export type ClassItem = components["schemas"]["ClassResponse"];
/** 班级成员花名册项。 */
export type ClassMemberItem = components["schemas"]["ClassMemberItem"];
/** 用户的班级归属（单用户多班级，一个用户可有多条）。 */
export type UserMembershipItem = components["schemas"]["UserMembershipItem"];
export type MemberRole = "student" | "teacher";

/**
 * 会话用户 —— `/auth/me` 的 `UserBrief` 投影（不再手写第二份同名结构）。
 *
 * 登录响应（`TokenResponse`）只给 userId/role/display_name/gender/avatar 子集，
 * `refreshUser()` 之后由 `UserBrief` 补齐；`created_at` 不参与前端会话身份，故剔除。
 */
export type User = Omit<components["schemas"]["UserBrief"], "created_at">;

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
