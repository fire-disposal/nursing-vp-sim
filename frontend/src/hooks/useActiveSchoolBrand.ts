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
	const isPlatform = useAuthStore((s) => s.permissions.includes("school_manage"));
	const scoped = useSchoolScopeStore((s) => s.school);
	const user = useAuthStore((s) => s.user);

	if (isPlatform) return { isPlatform, school: scoped };
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
