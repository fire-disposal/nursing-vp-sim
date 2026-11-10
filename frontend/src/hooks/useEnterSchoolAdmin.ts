import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { useNavigate } from "react-router-dom";

import type { SchoolItem } from "@/api/admin/schools";
import useAuthStore from "@/stores/authStore";
import { usePersonaStore } from "@/stores/personaStore";
import { toScopedSchool, useSchoolScopeStore } from "@/stores/schoolScopeStore";

/**
 * 「进入院校管理」——平台账号的日常入口，**唯一定义**。
 *
 * 院校列表的每行与院校详情页的主行动都走这里：选一所院校 → 以「管理」视角进入它的
 * 账号与班级控制台。两份实现迟早会漂移（一处忘了刷新权限、一处忘了清缓存），
 * 而这类漂移表现为"进去之后还是上一所学校的数据"，排查成本极高。
 *
 * 四个步骤都必要：
 * 1. 设作用域快照（顶栏与主题色读它，请求头 `X-School-Scope` 也读它）；
 * 2. 切到 admin 视角（只有被授予时才切，否则会是 403）；
 * 3. `queryClient.clear()` —— 换语境后所有院校维度的缓存都不再成立；
 * 4. `refreshUser()` —— 权限口径由服务端按视角/院校重算，不刷新就会拿着旧快照进 403 页。
 */
export function useEnterSchoolAdmin() {
	const queryClient = useQueryClient();
	const navigate = useNavigate();

	return useCallback(
		async (school: Pick<SchoolItem, "id" | "name" | "theme_color" | "has_logo" | "logo_updated_at">) => {
			useSchoolScopeStore.getState().setSchool(toScopedSchool(school));
			const persona = usePersonaStore.getState();
			if (persona.available.includes("admin")) persona.setActive("admin");
			queryClient.clear();
			await useAuthStore.getState().refreshUser();
			navigate("/admin/users");
		},
		[queryClient, navigate],
	);
}
