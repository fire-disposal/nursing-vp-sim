import { useQuery } from "@tanstack/react-query";
import { getPersonas } from "@/api/admin/personas";
import { getUsers } from "@/api/admin/users";
import { queryKeys } from "@/api/query-keys";
import type { PersonaOption } from "./types";

export function useUserList(offset: number, params: Record<string, unknown>) {
	return useQuery({
		queryKey: queryKeys.admin.users.list({ offset, ...params }),
		queryFn: () => getUsers({ offset, ...params }).then((r) => r.data),
		placeholderData: (prev) => prev,
		// 与其它列表查询对齐：壳过渡会短暂再挂载一次页面，缺少 staleTime 时会多打一次同样的请求
		staleTime: 60_000,
	});
}

/**
 * 可授予的视角目录（`/admin/personas`）：代码拥有的固定预设，不是自建角色。
 *
 * 失败时**不**回落静态预设 —— 那会把「读不到目录」伪装成「只有这几种视角」，
 * 而真实原因通常是没权限或网络坏了。调用方按 `isError` 显示诚实的占位。
 * 顺序沿用目录顺序（后端按 `PERSONAS` 的从窄到宽排列）。
 */
export function usePersonasQuery() {
	return useQuery({
		queryKey: queryKeys.admin.personas,
		queryFn: () =>
			getPersonas().then((r) =>
				r.data.map((p): PersonaOption => ({ value: p.key, label: p.label, grantable: p.grantable })),
			),
		staleTime: 5 * 60 * 1000,
	});
}
