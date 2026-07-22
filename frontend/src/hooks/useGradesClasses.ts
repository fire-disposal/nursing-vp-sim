import { useQuery } from "@tanstack/react-query";
import {
	createClass,
	createGrade,
	deleteClass,
	deleteGrade,
	getClasses,
	getGrades,
	updateClass,
	updateGrade,
} from "@/api";
import { queryKeys } from "@/api/query-keys";
import { useApiMutation } from "./useApiMutation";

export function useGradesQuery() {
	return useQuery({
		queryKey: queryKeys.grades.all,
		queryFn: () => getGrades().then((r) => r.data),
		staleTime: 5 * 60_000,
	});
}

export function useClassesQuery(gradeId?: number) {
	return useQuery({
		queryKey: queryKeys.grades.classes(gradeId),
		queryFn: () =>
			getClasses(gradeId ? { grade_id: gradeId } : {}).then((r) => r.data),
		staleTime: 5 * 60_000,
	});
}

export function useCreateGrade() {
	return useApiMutation({
		mutationFn: (name: string) => createGrade({ name }).then((r) => r.data),
		invalidateKeys: [queryKeys.grades.all],
		successMsg: "年级已创建",
	});
}

export function useUpdateGrade() {
	return useApiMutation({
		mutationFn: ({ id, name }: { id: number; name: string }) =>
			updateGrade(id, { name }).then((r) => r.data),
		invalidateKeys: [queryKeys.grades.all],
		successMsg: "年级已更新",
	});
}

export function useDeleteGrade() {
	return useApiMutation({
		mutationFn: (id: number) => deleteGrade(id),
		invalidateKeys: [queryKeys.grades.all, queryKeys.grades.classes()],
		successMsg: "年级已删除",
	});
}

export function useCreateClass() {
	return useApiMutation({
		mutationFn: ({ gradeId, name }: { gradeId: number; name: string }) =>
			createClass({ grade_id: gradeId, name }).then((r) => r.data),
		invalidateKeys: [queryKeys.grades.classes()],
		successMsg: "班级已创建",
	});
}

export function useUpdateClass() {
	return useApiMutation({
		mutationFn: ({
			id,
			body,
		}: { id: number; body: { name: string; grade_id: number } }) =>
			updateClass(id, body).then((r) => r.data),
		invalidateKeys: [queryKeys.grades.classes()],
		successMsg: "班级已更新",
	});
}

export function useDeleteClass() {
	return useApiMutation({
		mutationFn: (id: number) => deleteClass(id),
		invalidateKeys: [queryKeys.grades.classes()],
		successMsg: "班级已删除",
	});
}
