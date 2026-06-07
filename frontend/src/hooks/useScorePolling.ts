import { useCallback, useRef } from "react";
import { endTraining, getRecordDetail } from "@/api/training";
import { useToast } from "@/components/Toast";
import type { ScoreData } from "@/types/score";

interface UseScorePollingOptions {
  recordId: number | null;
  onScoreReady: (score: ScoreData) => void;
  onPostTestCheck: () => Promise<{ has_pending?: boolean } | undefined>;
}

export function useScorePolling({ recordId, onScoreReady, onPostTestCheck }: UseScorePollingOptions) {
  const toast = useToast();
  const scoreCancelRef = useRef(false);

  const executeEnd = useCallback(
    async (isAuto = false) => {
      if (!recordId) return;
      scoreCancelRef.current = false;

      try {
        await endTraining(recordId);
        for (let i = 0; i < 40; i++) {
          if (scoreCancelRef.current) break;
          await new Promise<void>((r) => setTimeout(r, 3000));
          const detail = await getRecordDetail(recordId);
          const data = detail.data as Record<string, unknown>;
          if (data.scoring_status === "completed" && data.score) {
            onScoreReady(data.score as ScoreData);
            onPostTestCheck();
            return;
          }
          if (data.scoring_status === "failed") {
            toast.error(`自动评分失败：${data.scoring_error || "未知错误，可在训练记录中手动重试"}`);
            return;
          }
        }
      } catch (err: unknown) {
        const axiosErr = err as { name?: string; code?: string; response?: { data?: { detail?: string } } };
        if (axiosErr.name !== "CanceledError" && axiosErr.code !== "ERR_CANCELED") {
          if (!isAuto) toast.error(axiosErr.response?.data?.detail || "结束训练失败，请重试");
        }
      }
    },
    [recordId, onScoreReady, onPostTestCheck, toast],
  );

  return { executeEnd, scoreCancelRef };
}
