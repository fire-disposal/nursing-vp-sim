import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

import type { MessageBus } from "@/engine/types";

/**
 * 评分完成后的自动跳转（无可见 UI）。
 *
 * 训练页唯一的评分展示在记录详情页，所以这里只做一件事：`score:ready` 后把学生送到
 * `/record/{id}`。短暂的 1.5s 停顿是给 `ScoringOverlay` 播完「评估完成」的收尾动画。
 */
export function ScoreCard({
	bus,
	recordId,
}: {
	bus: MessageBus;
	recordId: string;
}) {
	const navigate = useNavigate();

	useEffect(() => {
		const unsub = bus.on("score:ready", () => {
			// Brief pause so the user sees the completion state in ScoringOverlay
			setTimeout(() => {
				navigate(`/record/${recordId}`, { replace: true });
			}, 1500);
		});
		return unsub;
	}, [bus, recordId, navigate]);

	return null;
}
