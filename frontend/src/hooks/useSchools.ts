import { useQuery } from "@tanstack/react-query";
import { isAxiosError } from "axios";
import {
	createSchool,
	deleteSchool,
	deleteSchoolLogo,
	getSchoolDetail,
	getSchools,
	updateSchool,
	uploadSchoolLogo,
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

/**
 * 单所院校详情（`/admin/schools/:schoolId`）。
 *
 * 404 不重试：越权与不存在在后端同为 404（失败关闭），重试只会把"这所学校你看不到"
 * 变成三次无谓请求。其它错误交给 react-query 的默认重试。
 */
export function useSchoolDetailQuery(schoolId: number | null) {
	return useQuery({
		queryKey: queryKeys.schools.detail(schoolId),
		queryFn: () => getSchoolDetail(schoolId as number).then((r) => r.data),
		enabled: schoolId != null && Number.isFinite(schoolId),
		staleTime: 30_000,
		retry: (count, error) => !(isAxiosError(error) && error.response?.status === 404) && count < 1,
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
		mutationFn: ({
			id,
			name,
			theme_color,
		}: {
			id: number;
			name?: string;
			theme_color?: string | null;
		}) => updateSchool(id, { name, theme_color }),
		invalidateKeys: invalidate,
		successMsg: "院校已更新",
		errorMsg: "更新院校失败",
	});
}

/** 院徽上传/移除：只影响院校品牌，不动班级/账号缓存。 */
export function useUploadSchoolLogo() {
	return useApiMutation({
		mutationFn: ({ id, file }: { id: number; file: File }) =>
			uploadSchoolLogo(id, file),
		invalidateKeys: [queryKeys.schools.all],
		successMsg: "院徽已更新",
		errorMsg: "上传院徽失败",
	});
}

export function useDeleteSchoolLogo() {
	return useApiMutation({
		mutationFn: (id: number) => deleteSchoolLogo(id),
		invalidateKeys: [queryKeys.schools.all],
		successMsg: "院徽已移除",
		errorMsg: "移除院徽失败",
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
