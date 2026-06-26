import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
	activatePrompt,
	createPrompt,
	deletePrompt,
	updatePrompt,
} from "@/api/api-client";
import { queryKeys } from "@/api/query-keys";
import { useToast } from "@/components/Toast";
import type { PromptForm, PromptTemplateResponse } from "./types";
import { PURPOSE_LABELS } from "./types";

export function useSavePrompt() {
	const queryClient = useQueryClient();
	const toast = useToast();

	return useMutation({
		mutationFn: ({
			editingId,
			form,
			variables,
		}: {
			editingId: number | "new";
			form: PromptForm;
			variables?: { [key: string]: unknown }[] | null;
		}) => {
			if (editingId !== "new") {
				return updatePrompt(editingId, {
					name: form.name,
					system_prompt: form.system_prompt,
					user_prompt: form.user_prompt || null,
					remark: form.remark,
					...(variables != null ? { variables } : {}),
				});
			}
			return createPrompt(form);
		},
		onSuccess: (_data, { editingId }) => {
			toast.success(editingId !== "new" ? "已保存" : "已创建");
			queryClient.invalidateQueries({ queryKey: queryKeys.prompts.list });
		},
		onError: (err: unknown) => {
			const e = err as { response?: { data?: { detail?: unknown } } };
			const detail = e.response?.data?.detail;
			const msg = Array.isArray(detail)
				? (detail as { msg?: string; type?: string }[])
						.map((d) => d.msg || d.type || "未知错误")
						.join("; ")
				: detail || "保存失败";
			toast.error(msg as string);
		},
	});
}

export function useActivatePrompt() {
	const queryClient = useQueryClient();
	const toast = useToast();

	return useMutation({
		mutationFn: (p: PromptTemplateResponse) =>
			activatePrompt(p.id, p.id === 0 ? p.purpose : undefined),
		onSuccess: (_data, p) => {
			toast.success(
				p.id === 0
					? `已切换「${PURPOSE_LABELS[p.purpose]}」到内置版本`
					: `已切换到 v${p.version}`,
			);
			queryClient.invalidateQueries({ queryKey: queryKeys.prompts.list });
		},
		onError: (err: unknown) => {
			const e = err as { response?: { data?: { detail?: unknown } } };
			const d = e.response?.data?.detail;
			toast.error(
				Array.isArray(d)
					? (d as { msg?: string }[]).map((i) => i.msg).join("; ")
					: (d as string) || "激活失败",
			);
		},
	});
}

export function useDeletePrompt() {
	const queryClient = useQueryClient();
	const toast = useToast();

	return useMutation({
		mutationFn: (p: PromptTemplateResponse) => deletePrompt(p.id),
		onSuccess: () => {
			toast.success("已删除");
			queryClient.invalidateQueries({ queryKey: queryKeys.prompts.list });
		},
		onError: (err: unknown) => {
			toast.apiError(err, "删除失败");
		},
	});
}
