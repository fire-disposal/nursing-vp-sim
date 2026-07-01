import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { toast } from "@/components/Toast";
import { notifySSEProgress } from "@/engine";
import { useSSEStream } from "@/hooks/useSSEStream";
import useAuthStore from "@/stores/authStore";

export function useScoringNotifications() {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const token = useAuthStore((s) => s.token);

	useSSEStream({
		url: "/api/training/notifications/stream",
		token: token ?? "",
		onEvent: (eventType, data) => {
			const payload = data as {
				record_id?: number;
				error?: string;
			};
			if (eventType === "scoring_complete") {
				notifySSEProgress({
					record_id: payload.record_id!,
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
			}
			if (eventType === "scoring_failed") {
				notifySSEProgress({
					record_id: payload.record_id!,
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
			}
			if (eventType === "scoring_progress") {
				notifySSEProgress(data as Parameters<typeof notifySSEProgress>[0]);
			}
		},
		onError: (msg) => {
			console.warn("[useScoringNotifications] SSE error:", msg);
		},
		reconnectBaseDelay: 1000,
		reconnectMaxDelay: 30000,
	});
}
