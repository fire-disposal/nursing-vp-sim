import {
	type QueryKey,
	type UseMutationResult,
	useMutation,
	useQueryClient,
} from "@tanstack/react-query";
import { toast } from "@/components/Toast";

export interface ApiMutationOptions<TData, TVars> {
	mutationFn: (vars: TVars) => Promise<TData>;
	/** Query keys to invalidate on success. */
	invalidateKeys?: QueryKey[];
	/** Success toast — string, or a builder from the result/vars. Omit for no toast. */
	successMsg?: string | ((data: TData, vars: TVars) => string | null);
	/** Fallback message for the error toast (default "操作失败"). */
	errorMsg?: string;
	/** Extra success side-effects (runs after invalidation + toast). */
	onSuccess?: (data: TData, vars: TVars) => void;
	/** Override error handling entirely (skips the default apiError toast). */
	onError?: (err: unknown, vars: TVars) => void;
}

/**
 * Thin wrapper over `useMutation` that standardizes the ubiquitous
 * "invalidate + success toast / apiError toast" boilerplate while keeping
 * escape hatches (`onSuccess`/`onError`) for custom flows.
 */
export function useApiMutation<TData = unknown, TVars = void>(
	opts: ApiMutationOptions<TData, TVars>,
): UseMutationResult<TData, unknown, TVars> {
	const queryClient = useQueryClient();
	return useMutation<TData, unknown, TVars>({
		mutationFn: opts.mutationFn,
		onSuccess: (data, vars) => {
			for (const key of opts.invalidateKeys ?? []) {
				queryClient.invalidateQueries({ queryKey: key });
			}
			if (opts.successMsg != null) {
				const msg =
					typeof opts.successMsg === "function"
						? opts.successMsg(data, vars)
						: opts.successMsg;
				if (msg) toast.success(msg);
			}
			opts.onSuccess?.(data, vars);
		},
		onError: (err, vars) => {
			if (opts.onError) opts.onError(err, vars);
			else toast.apiError(err, opts.errorMsg);
		},
	});
}

export default useApiMutation;
