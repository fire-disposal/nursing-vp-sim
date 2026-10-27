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
import { useActiveSchoolBrand } from "@/hooks/useActiveSchoolBrand";
import type { ClassItem } from "@/types/store";
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

/**
 * 班级选项文案（**唯一实现**：筛选、作业、班级归属、成员编辑器共用）。
 *
 * 平台角色在「全部院校」视角下会同时看到多所院校的班级：只显示「届别 + 名称」时分不清
 * 同名的两所学校同名班级。院校前缀只在**跨院校可见时**出现（收窄到本校后是噪音），
 * 与列表里「院校列」的显隐规则同一口径（`useActiveSchoolBrand`）。
 */
export function useClassLabel() {
	const withSchool = useCrossSchoolLabels();
	return (item: ClassItem, options: { withCohort?: boolean } = {}) => {
		const withCohort = options.withCohort ?? true;
		return [
			withSchool ? item.school_name : null,
			withCohort ? item.cohort_label : null,
			item.name,
		]
			.filter(Boolean)
			.join(" ");
	};
}

/** 班级分组的文案（成员编辑器按届别分组时用）：跨院校可见时把院校并进分组名。 */
export function useClassGroupLabel() {
	const withSchool = useCrossSchoolLabels();
	return (item: ClassItem) =>
		[withSchool ? item.school_name : null, item.cohort_label || "未标注届别"]
			.filter(Boolean)
			.join(" · ");
}

/** 是否需要带院校前缀：平台角色 + 未收窄到某一所（与列表「院校列」同一显隐口径）。 */
function useCrossSchoolLabels(): boolean {
	const { isPlatform, school } = useActiveSchoolBrand();
	return isPlatform && !school;
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
		mutationFn: (body: { name: string; cohort_label: string; school_id?: number }) =>
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
			body: { name?: string; cohort_label?: string; school_id?: number };
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
