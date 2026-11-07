import { api } from "../client";

/**
 * 视角（Persona）——权限预设包。与旧「角色」的区别：角色是自建的一组权限，
 * 视角是**固定的四档预设 + 数据作用域（tenant/class/self）**，账号可被授予多个视角，
 * 请求头 `X-View-Persona` 选择当前生效的那一个。
 *
 * 类型暂写在这里（后端契约先于 openapi 生成落地）：`api-types.gen.ts` 是生成文件，
 * 不在本次改动范围内；接口稳定后可换成 `components["schemas"][...]`。
 */
export type PersonaScope = "tenant" | "class" | "self";

export interface PersonaPreset {
	key: string;
	label: string;
	/** 数据作用域：全校 / 本人班级 / 仅本人 */
	scope: PersonaScope;
	permissions: string[];
	/** 已授予人数——按调用者作用域统计（平台全局 / 院校本校） */
	user_count: number;
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
