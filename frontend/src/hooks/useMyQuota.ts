import { useQuery } from "@tanstack/react-query";

import { getMyQuota } from "@/api/admin/budgets";

/** 当前用户的日额度与院校月额度；额度不足时前端提前提示。 */
export function useMyQuota() {
	return useQuery({
		queryKey: ["my-quota"],
		queryFn: () => getMyQuota().then((r) => r.data),
		staleTime: 60_000,
		retry: false,
	});
}
