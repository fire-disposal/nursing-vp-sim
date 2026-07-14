import { useMutation, useQueryClient } from "@tanstack/react-query";
import { batchCreateUsers, deleteUser, updateUser } from "@/api/admin/users";
import type { components } from "@/api/api-types.gen";
import { register } from "@/api/auth";
import { queryKeys } from "@/api/query-keys";
import { toast } from "@/components/Toast";

type Schemas = components["schemas"];

export function useRegisterMutation() {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: (payload: Schemas["RegisterRequest"]) => register(payload),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: queryKeys.admin.users.all });
			toast.success("注册成功！");
		},
		onError: (err: unknown) => {
			toast.apiError(err, "注册失败");
		},
	});
}

export function useUpdateUserMutation() {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: ({
			id,
			data,
		}: {
			id: number | string;
			data: Record<string, unknown>;
		}) => updateUser(id, data),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: queryKeys.admin.users.all });
			toast.success("用户已更新");
		},
		onError: (err: unknown) => {
			toast.apiError(err, "保存失败");
		},
	});
}

export function useDeleteUserMutation() {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: (id: number | string) => deleteUser(id),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: queryKeys.admin.users.all });
			toast.success("用户已删除");
		},
		onError: (err: unknown) => {
			toast.apiError(err, "删除失败");
		},
	});
}

export function useBatchCreateUsersMutation() {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: (users: Schemas["BatchUserItem"][]) =>
			batchCreateUsers(users).then((r) => r.data),
		onSuccess: (data) => {
			queryClient.invalidateQueries({ queryKey: queryKeys.admin.users.all });
			if (data.created > 0) {
				toast.success(`成功创建 ${data.created} 名用户`);
			}
			if (data.skipped > 0) {
				const details = (data.errors || []).slice(0, 3).join("；");
				toast.warning(`跳过 ${data.skipped} 名用户${details ? `：${details}` : ""}`);
			}
		},
		onError: (err: unknown) => {
			toast.apiError(err, "批量导入失败");
		},
	});
}
