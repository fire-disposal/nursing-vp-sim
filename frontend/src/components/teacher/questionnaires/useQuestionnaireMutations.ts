import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/axios-instance";
import { queryKeys } from "@/api/query-keys";
import { toast } from "@/components/Toast";
import type { TemplateForm } from "@/components/teacher/questionnaires/types";

export function useSaveTemplateMutation() {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async ({
			form,
			editingId,
		}: {
			form: TemplateForm;
			editingId: number | null;
		}) => {
			const payload = {
				title: form.title,
				type: form.type,
				description: form.description,
				is_active: form.is_active,
				questions: form.questions.map((q) => ({
					...(q.id ? { id: q.id } : {}),
					content: q.content,
					question_type: q.question_type,
					required: q.required,
					sort_order: q.sort_order,
					options:
						q.question_type === "multiple_choice"
							? q.options.filter(Boolean)
							: undefined,
				})),
			};
			if (editingId) {
				return api.put(`/questionnaires/templates/${editingId}`, payload);
			}
			return api.post("/questionnaires/templates", payload);
		},
		onSuccess: (_data, { editingId }) => {
			queryClient.invalidateQueries({ queryKey: queryKeys.questionnaires.all });
			toast.success(editingId ? "问卷模板已更新" : "问卷模板已创建");
		},
		onError: (err: unknown) => {
			toast.apiError(err, "保存失败");
		},
	});
}

export function useDeleteTemplateMutation() {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: (id: number) => api.delete(`/questionnaires/templates/${id}`),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: queryKeys.questionnaires.all });
			toast.success("问卷模板已删除");
		},
		onError: (err: unknown) => {
			toast.apiError(err, "删除失败");
		},
	});
}

export function useAssignTemplateMutation() {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: ({
			templateId,
			payload,
		}: {
			templateId: number;
			payload: {
				case_ids: number[];
				is_required: boolean;
				trigger_event: string;
			};
		}) =>
			api.put(
				`/questionnaires/templates/${templateId}/case-assignments`,
				payload,
			),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: queryKeys.questionnaires.all });
			toast.success("病例分配已更新");
		},
		onError: (err: unknown) => {
			toast.apiError(err, "分配失败");
		},
	});
}
