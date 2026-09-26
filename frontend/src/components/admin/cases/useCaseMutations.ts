import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	archiveCase,
	createCase,
	deleteCase,
	generateCase,
	getCaseRevisions,
	publishCase,
	updateCase,
} from "@/api";
import { queryKeys } from "@/api/query-keys";
import { useToast } from "@/components/Toast";
import { useConfirm } from "@/components/ui/confirm";
import type { components } from "@/api/api-types.gen";

type CaseManageItem = components["schemas"]["CaseManageItem"];

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

/** 发布：门禁通过才落版本；失败由调用方渲染字段级报告。 */
export function usePublishCase() {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: (id: number) => publishCase(id),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: queryKeys.cases.managed.all });
		},
	});
}

/** 归档：终止动作，只阻止新使用（历史版本与既有训练保留）。 */
export function useArchiveCase() {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: (id: number) => archiveCase(id),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: queryKeys.cases.managed.all });
		},
	});
}

/** 版本历史（新→旧）；仅在打开版本面板时拉取。 */
export function useCaseRevisions(caseId: number | null) {
	const id = caseId ?? 0;
	return useQuery({
		queryKey: queryKeys.cases.managed.revisions(id),
		queryFn: () => getCaseRevisions(id).then((r) => r.data),
		enabled: caseId != null,
		staleTime: 30_000,
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
			message: `确定删除病例"${c.name}"吗？已被作业引用的病例无法删除（后端会拒绝，请先删除相关作业）。`,
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
