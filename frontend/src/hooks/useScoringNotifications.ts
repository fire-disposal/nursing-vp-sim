import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { toast } from "@/components/Toast";
import { notifySSEProgress } from "@/engine";
import { useTrainingWS } from "@/hooks/useTrainingWS";

export function useScoringNotifications() {
	const navigate = useNavigate();
	const queryClient = useQueryClient();

	useTrainingWS((msg) => {
		switch (msg.type) {
			case "scoring_complete": {
				const payload = msg as unknown as { record_id: number; error?: string };
				if (!payload.record_id) break;
				notifySSEProgress({
					record_id: payload.record_id,
					stage: "completed",
					percent: 100,
					message: "评分完成",
				});
				queryClient.invalidateQueries({ queryKey: ["notifications"] });
				toast.success("评分已完成！", {
					description: "训练评分已生成，可点击查看详情",
					action: {
						label: "查看",
						onClick: () => navigate(`/record/${payload.record_id}`),
					},
					duration: 10000,
				});
				break;
			}
			case "scoring_failed": {
				const payload = msg as unknown as { record_id: number; error?: string };
				if (!payload.record_id) break;
				notifySSEProgress({
					record_id: payload.record_id,
					stage: "failed",
					percent: 0,
					message: payload.error || "评分失败",
				});
				queryClient.invalidateQueries({ queryKey: ["notifications"] });
				toast.error("评分失败", {
					description: payload.error || "请稍后重试",
					action: {
						label: "查看",
						onClick: () => navigate(`/record/${payload.record_id}`),
					},
					duration: 10000,
				});
				break;
			}
			case "scoring_progress": {
				const payload = msg as unknown as Parameters<typeof notifySSEProgress>[0];
				notifySSEProgress(payload);
				break;
			}
		}
	});
}
