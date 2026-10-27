import { Badge, Text } from "@mantine/core";
import type { components } from "@/api/api-types.gen";

type TrainingRecordBrief = components["schemas"]["TrainingRecordBrief"];

/**
 * 「成绩来源」标记 —— 列表成绩口径的唯一实现（训练选择·最近训练 / 训练记录 共用）。
 *
 * 有效分 = COALESCE(教师复核分, AI 初评分)，来源一律以服务端下发为准：
 * `score_degraded` / `score_source` 命中即降级分（不得冒充正常成绩），
 * 否则按 `score_reviewed` 区分教师复核 / AI 初评；无分（score_total 为空）显示占位符，
 * 不猜测补一个假来源。
 */
export default function ScoreSourceBadge({ record }: { record: TrainingRecordBrief }) {
	if (record.score_total == null) {
		return (
			<Text component="span" size="xs" c="dimmed" opacity={0.4}>
				—
			</Text>
		);
	}
	if (record.score_degraded || record.score_source === "fallback") {
		return (
			<Badge variant="light" color="red" size="sm">
				系统降级
			</Badge>
		);
	}
	return (
		<Badge variant="light" color={record.score_reviewed ? "green" : "brand"} size="sm">
			{record.score_reviewed ? "教师复核" : "AI 初评"}
		</Badge>
	);
}
