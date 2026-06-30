import { type DefaultError, type QueryKey, type UseQueryOptions, useQuery } from "@tanstack/react-query";
import type { AxiosResponse } from "axios";

/**
 * Wraps TanStack Query's useQuery with automatic AxiosResponse.data unwrapping.
 *
 * Eliminates the `.then(r => r.data)` / `data?.data` pattern inconsistency
 * that arose after removing the API response envelope middleware.
 *
 * Usage:
 *   const { data: classes, isLoading } = useApiQuery({
 *     queryKey: ["classes"],
 *     queryFn: () => api.get<ClassResponse[]>("/admin/classes"),
 *   });
 *   // classes is ClassResponse[] — no .data dereference needed
 */
export function useApiQuery<
	TData,
	TQueryKey extends QueryKey = QueryKey,
	TError = DefaultError,
>(
	options: Omit<UseQueryOptions<TData, TError, TData, TQueryKey>, "queryFn" | "select"> & {
		queryFn: () => Promise<AxiosResponse<TData>>;
	},
) {
	return useQuery<TData, TError, TData, TQueryKey>({
		...options,
		queryFn: () => options.queryFn().then((r) => r.data) as Promise<TData>,
	} as UseQueryOptions<TData, TError, TData, TQueryKey>);
}
