import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { retryScoring } from "@/api";
import { queryKeys } from "@/api/query-keys";
import { useToast } from "@/components/Toast";

/**
 * 评分状态刷新与重新触发 —— 学生结果页与教师详情页共用。
 *
 * 两个动作语义不同，**不允许合并**：
 * - `refresh()`：只读 GET（重新拉取记录详情查询，不触发评分、不轮询）；
 * - `retry(force?)`：POST retry-scoring 重新触发评分，随后触发一次 GET 刷新。
 *
 * 等待终态不在这里做：详情查询自己按 `scoring_status` 的 pending/processing
 * 状态轮询，评分完成后由查询把结果带进页面 —— 这样"等待"只有一个数据源，
 * 也不会出现界面自造的假进度。
 */
export function useScoringRetry(recordId: string | undefined) {
	const toast = useToast();
	const queryClient = useQueryClient();
	const [retrying, setRetrying] = useState(false);
	const [refreshing, setRefreshing] = useState(false);

	/** 只读刷新：GET 记录详情（无副作用，不 POST、不建轮询） */
	const refresh = useCallback(async () => {
		if (!recordId) return;
		setRefreshing(true);
		try {
			await queryClient.refetchQueries({ queryKey: queryKeys.training.detail(recordId) });
		} catch (err: unknown) {
			toast.apiError(err, "刷新状态失败");
		} finally {
			setRefreshing(false);
		}
	}, [recordId, queryClient, toast]);

	/** 重新触发评分（POST retry-scoring）；`force=true` 对应后端丢弃已有教师复核的分支 */
	const retry = useCallback(
		async (force = false) => {
			if (!recordId) return;
			setRetrying(true);
			try {
				await retryScoring(recordId, force ? { force: true } : undefined);
				toast.info("评分已重新触发，状态将随刷新更新");
			} catch (err: unknown) {
				toast.apiError(err, "重新评分失败");
			} finally {
				setRetrying(false);
			}
			await refresh();
		},
		[recordId, refresh, toast],
	);

	return { retrying, refreshing, refresh, retry };
}
