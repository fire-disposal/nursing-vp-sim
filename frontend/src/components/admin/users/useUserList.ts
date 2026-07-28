import { useQuery } from "@tanstack/react-query";
import { getRoles } from "@/api/admin/roles";
import { getUsers } from "@/api/admin/users";
import { queryKeys } from "@/api/query-keys";
import type { RoleOption } from "./types";

export function useUserList(offset: number, params: Record<string, unknown>) {
	return useQuery({
		queryKey: queryKeys.admin.users.list({ offset, ...params }),
		queryFn: () => getUsers({ offset, ...params }).then((r) => r.data),
		placeholderData: (prev) => prev,
	});
}

export function useRolesQuery() {
	return useQuery({
		queryKey: queryKeys.admin.roles,
		queryFn: () => getRoles().then((r) => r.data as RoleOption[]),
		staleTime: 5 * 60 * 1000,
	});
}
