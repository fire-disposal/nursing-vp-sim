import useAuthStore from "@/stores/authStore";
import { type ScopedSchool, useSchoolScopeStore } from "@/stores/schoolScopeStore";

/**
 * 当前生效的院校品牌（壳顶栏、主题色、院校列都要它，口径只此一处）。
 *
 * - 平台角色（`school_manage`）：取「当前院校」作用域快照；未选学校 = 平台视角（无院校品牌）。
 * - 院校角色：自己的院校，品牌字段来自 `/auth/me`（`school_theme_color` / `school_has_logo`）。
 *
 * 注意：这是**观感**，不是隔离。隔离只由服务端 `core/tenant.py` 决定。
 */
export function useActiveSchoolBrand(): { isPlatform: boolean; school: ScopedSchool | null } {
	const user = useAuthStore((s) => s.user);
	const isPlatform = user?.is_platform === true;
	const scoped = useSchoolScopeStore((s) => s.school);

	// 任何账号选中了具体院校（平台工作视图 / 普通多校账号）都以快照为准。
	if (scoped) return { isPlatform, school: scoped };
	if (!user?.school_id) return { isPlatform, school: null };
	return {
		isPlatform,
		school: {
			id: user.school_id,
			name: user.school_name ?? `院校 #${user.school_id}`,
			themeColor: user.school_theme_color ?? null,
			hasLogo: user.school_has_logo ?? false,
			logoUpdatedAt: user.school_logo_updated_at ?? null,
		},
	};
}
