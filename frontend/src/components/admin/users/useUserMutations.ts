import { useMutation, useQueryClient } from "@tanstack/react-query";
import { deleteUser, updateUser } from "@/api/admin/users";
import type { components } from "@/api/api-types.gen";
import { register } from "@/api/auth";
import { queryKeys } from "@/api/query-keys";
import { toast } from "@/components/Toast";
import type { RegisterPayload, UpdatePayload } from "./types";

type Schemas = components["schemas"];

export function useRegisterMutation() {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async ({
			payload,
			memberships,
		}: {
			payload: RegisterPayload;
			memberships: Schemas["UserMembershipUpdate"][];
		}) => {
			// 注册接口只接受单个 class_id：首个归属随注册提交，其余归属注册后全量替换。
			const { data } = await register({
				...payload,
				class_id: memberships[0]?.class_id ?? undefined,
			});
			if (memberships.length > 1) {
				await updateUser(data.id, { memberships });
			}
			return data;
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: queryKeys.admin.users.all });
			queryClient.invalidateQueries({ queryKey: queryKeys.classes.all });
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
			data: UpdatePayload;
		}) => updateUser(id, data),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: queryKeys.admin.users.all });
			queryClient.invalidateQueries({ queryKey: queryKeys.classes.all });
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
