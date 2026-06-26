import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
	createCase,
	deleteCase,
	generateCase,
	updateCase,
} from "@/api/api-client";
import { queryKeys } from "@/api/query-keys";
import { useToast } from "@/components/Toast";
import { useConfirm } from "@/components/ui/confirm";
import type { CaseManageItem } from "./types";

export function useCreateCase() {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: (data: Parameters<typeof createCase>[0]) => createCase(data),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: queryKeys.cases.managed.all });
		},
	});
}

export function useUpdateCase() {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: ({
			id,
			data,
		}: {
			id: number;
			data: Parameters<typeof updateCase>[1];
		}) => updateCase(id, data),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: queryKeys.cases.managed.all });
		},
	});
}

export function useDeleteCase() {
	const queryClient = useQueryClient();
	const toast = useToast();

	return useMutation({
		mutationFn: (id: number) => deleteCase(id),
		onSuccess: () => {
			toast.success("病例已删除");
			queryClient.invalidateQueries({ queryKey: queryKeys.cases.managed.all });
		},
		onError: (err: unknown) => {
			toast.apiError(err, "删除失败");
		},
	});
}

export function useDeleteCaseConfirm() {
	const toast = useToast();
	const { confirm } = useConfirm();

	const checkAndConfirm = async (c: CaseManageItem): Promise<boolean> => {
		if (c.training_count > 0) {
			toast.warning(`该病例已有 ${c.training_count} 条训练记录，无法删除`);
			return false;
		}
		return confirm({
			title: "删除病例",
			message: `确定删除病例"${c.name}"吗？`,
			confirmLabel: "确定删除",
			danger: true,
		});
	};

	return checkAndConfirm;
}

export function useGenerateCase() {
	return useMutation({
		mutationFn: (data: Parameters<typeof generateCase>[0]) =>
			generateCase(data),
	});
}
