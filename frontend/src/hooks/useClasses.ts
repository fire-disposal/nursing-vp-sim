import { useQuery } from "@tanstack/react-query";
import {
	addClassMembers,
	createClass,
	deleteClass,
	getClass,
	getClassMembers,
	getClassSummary,
	getClasses,
	removeClassMember,
	removeClassMembers,
	updateClass,
} from "@/api";
import { queryKeys } from "@/api/query-keys";
import { useApiMutation } from "./useApiMutation";

/**
 * 班级列表。`cohortLabel` 为空 = 全部届别。
 * 同时缓存到固定 key，供 ClassFilter 等筛选控件复用。
 */
export function useClassesQuery(cohortLabel?: string | null) {
	return useQuery({
		queryKey: queryKeys.classes.list(cohortLabel ?? null),
		queryFn: () =>
			getClasses(
				cohortLabel ? { cohort_label: cohortLabel } : {},
			).then((r) => r.data),
		staleTime: 5 * 60_000,
	});
}

/** 全部届别标签（去重后排序），供筛选下拉使用。 */
export function useCohortLabels() {
	const { data: classes = [], ...rest } = useClassesQuery(null);
	const labels = [...new Set(classes.map((c) => c.cohort_label).filter(Boolean))].sort(
		(a, b) => a.localeCompare(b, "zh-CN"),
	);
	return { labels, ...rest };
}

export function useClassDetailQuery(classId: number | string | undefined) {
	return useQuery({
		queryKey: queryKeys.classes.detail(classId ?? ""),
		queryFn: () => getClass(classId!).then((r) => r.data),
		enabled: classId != null && classId !== "" && !Number.isNaN(Number(classId)),
	});
}

export function useClassMembersQuery(
	classId: number | string | undefined,
	params: Record<string, unknown>,
) {
	return useQuery({
		queryKey: queryKeys.classes.members(classId ?? "", params),
		queryFn: () => getClassMembers(classId!, params).then((r) => r.data),
		enabled: classId != null && classId !== "",
		placeholderData: (prev) => prev,
	});
}

export function useClassSummaryQuery(classId: number | string | undefined) {
	return useQuery({
		queryKey: queryKeys.classes.summary(classId ?? ""),
		queryFn: () =>
			getClassSummary({ class_id: classId }).then((r) => r.data),
		enabled: classId != null && classId !== "",
		staleTime: 60_000,
	});
}

const classKeys = () => [queryKeys.classes.all, queryKeys.admin.users.all];

export function useCreateClass() {
	return useApiMutation({
		mutationFn: (body: { name: string; cohort_label: string }) =>
			createClass(body).then((r) => r.data),
		invalidateKeys: classKeys(),
		successMsg: "班级已创建",
	});
}

export function useUpdateClass() {
	return useApiMutation({
		mutationFn: ({
			id,
			body,
		}: {
			id: number;
			body: { name?: string; cohort_label?: string };
		}) => updateClass(id, body).then((r) => r.data),
		invalidateKeys: classKeys(),
		successMsg: "班级已更新",
	});
}

export function useDeleteClass() {
	return useApiMutation({
		mutationFn: (id: number) => deleteClass(id),
		invalidateKeys: classKeys(),
		successMsg: "班级已删除",
	});
}

export function useAddClassMembers(classId: number | string) {
	return useApiMutation({
		mutationFn: ({
			userIds,
			memberRole,
		}: {
			userIds: number[];
			memberRole: "student" | "teacher";
		}) =>
			addClassMembers(classId, userIds, memberRole).then((r) => r.data),
		invalidateKeys: [
			queryKeys.classes.all,
			queryKeys.classes.detail(classId),
			queryKeys.admin.users.all,
		],
	});
}

export function useRemoveClassMembers(classId: number | string) {
	return useApiMutation({
		mutationFn: (userIds: number[]) =>
			removeClassMembers(classId, userIds).then((r) => r.data),
		invalidateKeys: [
			queryKeys.classes.all,
			queryKeys.classes.detail(classId),
			queryKeys.admin.users.all,
		],
	});
}

export function useRemoveClassMember(classId: number | string) {
	return useApiMutation({
		mutationFn: (userId: number) =>
			removeClassMember(classId, userId).then((r) => r.data),
		invalidateKeys: [
			queryKeys.classes.all,
			queryKeys.classes.detail(classId),
			queryKeys.admin.users.all,
		],
	});
}
