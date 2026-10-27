import { useQuery } from "@tanstack/react-query";
import {
	createSchool,
	deleteSchool,
	getSchools,
	updateSchool,
} from "@/api/admin/schools";
import { queryKeys } from "@/api/query-keys";
import { useApiMutation } from "./useApiMutation";

/**
 * 院校列表。跨院校可见性由后端按 `school_manage` 判定，前端不做过滤。
 * `enabled` 给「只有平台角色才需要这份列表」的页面用，避免院校管理员白打一次 403。
 */
export function useSchoolsQuery(options: { enabled?: boolean } = {}) {
	return useQuery({
		queryKey: queryKeys.schools.all,
		queryFn: () => getSchools().then((r) => r.data),
		staleTime: 60_000,
		enabled: options.enabled ?? true,
	});
}

const invalidate = [queryKeys.schools.all, queryKeys.classes.all, queryKeys.admin.users.all];

export function useCreateSchool() {
	return useApiMutation({
		mutationFn: createSchool,
		invalidateKeys: invalidate,
		successMsg: "院校已创建",
		errorMsg: "创建院校失败",
	});
}

export function useUpdateSchool() {
	return useApiMutation({
		mutationFn: ({ id, name }: { id: number; name: string }) =>
			updateSchool(id, { name }),
		invalidateKeys: invalidate,
		successMsg: "院校已更新",
		errorMsg: "更新院校失败",
	});
}

export function useDeleteSchool() {
	return useApiMutation({
		mutationFn: deleteSchool,
		invalidateKeys: invalidate,
		successMsg: (_data, id) => `已删除院校 #${id}`,
		errorMsg: "删除院校失败",
	});
}
