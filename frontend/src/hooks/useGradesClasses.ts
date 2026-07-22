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
import { useApiMutation } from "./useApiMutation";

export const gradesKeys = {
	all: ["grades"] as const,
	list: () => [...gradesKeys.all, "list"] as const,
	classes: (gradeId?: number) =>
		[...gradesKeys.all, "classes", gradeId ?? "all"] as const,
};

export function useGradesQuery() {
	return useQuery({
		queryKey: gradesKeys.list(),
		queryFn: () => getGrades().then((r) => r.data),
		staleTime: 5 * 60_000,
	});
}

export function useClassesQuery(gradeId?: number) {
	return useQuery({
		queryKey: gradesKeys.classes(gradeId),
		queryFn: () =>
			getClasses(gradeId ? { grade_id: gradeId } : {}).then((r) => r.data),
		staleTime: 5 * 60_000,
	});
}

export function useCreateGrade() {
	return useApiMutation({
		mutationFn: (name: string) => createGrade({ name }).then((r) => r.data),
		invalidateKeys: [gradesKeys.list()],
		successMsg: "年级已创建",
	});
}

export function useUpdateGrade() {
	return useApiMutation({
		mutationFn: ({ id, name }: { id: number; name: string }) =>
			updateGrade(id, { name }).then((r) => r.data),
		invalidateKeys: [gradesKeys.list()],
		successMsg: "年级已更新",
	});
}

export function useDeleteGrade() {
	return useApiMutation({
		mutationFn: (id: number) => deleteGrade(id),
		invalidateKeys: [gradesKeys.list(), gradesKeys.classes()],
		successMsg: "年级已删除",
	});
}

export function useCreateClass() {
	return useApiMutation({
		mutationFn: ({ gradeId, name }: { gradeId: number; name: string }) =>
			createClass({ grade_id: gradeId, name }).then((r) => r.data),
		invalidateKeys: [gradesKeys.classes()],
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
		invalidateKeys: [gradesKeys.classes()],
		successMsg: "班级已更新",
	});
}

export function useDeleteClass() {
	return useApiMutation({
		mutationFn: (id: number) => deleteClass(id),
		invalidateKeys: [gradesKeys.classes()],
		successMsg: "班级已删除",
	});
}
