import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * 「当前院校」作用域（仅平台角色可设）。
 *
 * 语义：**视图收窄，不是授权**。平台角色本来跨院校；把工作视图收窄到某一所只是
 * 让列表/统计/新建都落在同一所学校。院校角色的院校是硬边界，服务端一律忽略这个作用域。
 *
 * 存的是**快照**（名称/主题色/院徽版本）：壳顶栏与主题色在 MantineProvider 之上就要用，
 * 那里拿不到 react-query；快照随院校列表刷新同步更新。
 */
export interface ScopedSchool {
	id: number;
	name: string;
	/** 主题色调色板键（`theme/school-palettes`）；null = 平台默认品牌色 */
	themeColor: string | null;
	hasLogo: boolean;
	logoUpdatedAt: string | null;
}

interface SchoolScopeState {
	/** null = 全部院校（平台视角） */
	school: ScopedSchool | null;
	setSchool: (school: ScopedSchool | null) => void;
}

export const useSchoolScopeStore = create<SchoolScopeState>()(
	persist(
		(set) => ({
			school: null,
			setSchool: (school) => set({ school }),
		}),
		{ name: "school-scope" },
	),
);

/** 视角切换器请求打开院校菜单（平台账号未选校时把下一步直接摆出来）。 */
export const SCHOOL_MENU_REQUEST_EVENT = "nvp:request-school-menu";

/** 院徽地址：带版本号，换图即换 URL（公开读端点，`<img>` 带不了 Authorization）。 */
export function schoolLogoUrl(school: Pick<ScopedSchool, "id" | "logoUpdatedAt">): string {
	const version = school.logoUpdatedAt ? `?v=${encodeURIComponent(school.logoUpdatedAt)}` : "";
	return `/api/schools/${school.id}/logo${version}`;
}

/** 院校接口对象 → 作用域快照（顶栏与主题读快照；两处调用点共用这一种形状转换）。 */
export function toScopedSchool(school: {
	id: number;
	name: string;
	theme_color?: string | null;
	has_logo?: boolean;
	logo_updated_at?: string | null;
}): ScopedSchool {
	return {
		id: school.id,
		name: school.name,
		themeColor: school.theme_color ?? null,
		hasLogo: !!school.has_logo,
		logoUpdatedAt: school.logo_updated_at ?? null,
	};
}
