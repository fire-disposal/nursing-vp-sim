import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { getRecordDetail, retryScoring } from "@/api";
import { queryKeys } from "@/api/query-keys";
import { useToast } from "@/components/Toast";

/** 轮询间隔 / 轮询次数上限（原教师详情页硬编码行为，现为两页唯一实现）。 */
const POLL_INTERVAL_MS = 3000;
const POLL_MAX = 30;

function sleep(ms: number, signal: AbortSignal) {
	return new Promise<void>((resolve) => {
		const timer = setTimeout(resolve, ms);
		signal.addEventListener("abort", () => clearTimeout(timer), { once: true });
	});
}

/**
 * 重新触发评分并轮询等待结果 —— 学生结果页与教师详情页共用。
 *
 * `force=true` 对应后端丢弃已有教师复核的分支（教师页在已复核时使用）。
 * 组件卸载或 `recordId` 变化时中止在途轮询。
 */
export function useScoringRetry(recordId: string | undefined) {
	const toast = useToast();
	const queryClient = useQueryClient();
	const [retrying, setRetrying] = useState(false);
	const [retryProgress, setRetryProgress] = useState<number | null>(null);
	const abortRef = useRef<AbortController | null>(null);
	const lockRef = useRef(false);

	useEffect(() => () => abortRef.current?.abort(), []);

	const retry = useCallback(
		async (force = false) => {
			if (!recordId || lockRef.current) return;
			lockRef.current = true;
			setRetrying(true);
			setRetryProgress(0);
			const controller = new AbortController();
			abortRef.current = controller;
			try {
				await retryScoring(recordId, force ? { force: true } : undefined);
				toast.info("评分已重新触发，请稍后刷新查看结果");
				for (let i = 0; i < POLL_MAX; i++) {
					setRetryProgress(i + 1);
					if (controller.signal.aborted) break;
					await sleep(POLL_INTERVAL_MS, controller.signal);
					if (controller.signal.aborted) break;
					const { data } = await getRecordDetail(recordId);
					if (controller.signal.aborted) break;
					if (data.scoring_status === "completed" && data.score) {
						queryClient.setQueryData(queryKeys.training.detail(recordId), data);
						toast.success("评分已完成");
						break;
					}
					if (data.scoring_status === "failed") {
						queryClient.setQueryData(queryKeys.training.detail(recordId), data);
						toast.error(`评分再次失败: ${data.scoring_error || "未知错误"}`);
						break;
					}
				}
			} catch (err: unknown) {
				if (err instanceof DOMException && err.name === "AbortError") return;
				toast.apiError(err, "重试评分失败");
			} finally {
				lockRef.current = false;
				setRetrying(false);
				setRetryProgress(null);
			}
		},
		[recordId, toast, queryClient],
	);

	return { retrying, retryProgress, retry };
}
