import { api } from "../client";

/**
 * 视角（Persona）——权限预设包。与旧「角色」的区别：角色是自建的一组权限，
 * 视角是**固定的五档预设 + 数据作用域（platform/tenant/self）**，账号可被授予多个视角，
 * 请求头 `X-View-Persona` 选择当前生效的那一个。
 */
export type PersonaScope = "platform" | "tenant" | "self";

export interface PersonaPreset {
	key: string;
	label: string;
	/** 数据作用域：平台跨校 / 全校 / 仅本人 */
	scope: PersonaScope;
	permissions: string[];
	/** 已授予人数——按调用者作用域统计（平台全局 / 院校本校） */
	user_count: number;
	/** 调用者当前能否授予这一档（后端按预设 ⊆ 当前权限算；平台账号恒为 true） */
	grantable: boolean;
}

export interface UserPersonas {
	user_id: number;
	personas: string[];
}

export const getPersonas = () =>
	api.get<PersonaPreset[]>("/admin/personas");

export const getUserPersonas = (userId: number | string) =>
	api.get<UserPersonas>(`/admin/users/${userId}/personas`);

/** 替换授予：整体覆盖该账号的视角集合（后端去重 + 校验可授予性）。 */
export const setUserPersonas = (userId: number | string, personas: string[]) =>
	api.put<UserPersonas>(`/admin/users/${userId}/personas`, { personas });

/** 某账号在指定院校的视角授予（跨校授权只允许平台账号）。 */
export const getUserSchoolPersonas = (userId: number | string, schoolId: number) =>
	api.get<UserPersonas>(`/admin/users/${userId}/personas/schools/${schoolId}`);

export const setUserSchoolPersonas = (userId: number | string, schoolId: number, personas: string[]) =>
	api.put<UserPersonas>(`/admin/users/${userId}/personas/schools/${schoolId}`, { personas });
