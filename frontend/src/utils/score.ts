import type { DetailScoreCategory, ScoreData } from "@/types/score";

/**
 * 评分载荷的唯一转换点。
 *
 * OpenAPI 生成类型里 `score.detail_scores` 是 `Record<string, unknown>`（后端 schema
 * 就是 `dict | None`），前端消费需要的精确结构由 `ScoreData` 描述 —— 只在这里做
 * 一次边界转换，调用点不再各自 `as ScoreData`。
 */
export function toScoreData(raw: unknown): ScoreData | null {
	if (raw == null || typeof raw !== "object") return null;
	return raw as ScoreData;
}

/**
 * 评分分母（该次评分的满分）—— 唯一实现，学生页 / 教师页 / 评分卡共用。
 *
 * 口径 = 各维度满分之和（rubric 维度权重之和，线上 = 100）。维度信息缺失或
 * 全为 0 时退回 `total_score`，再退回 100 分制默认值，保证分母不会为 0、也
 * 不会被显示成小于得分本身（不再使用无来源的 `+30` 兜底）。
 */
export function getScoreDenominator(score: ScoreData | null | undefined): number {
	if (!score) return 100;
	const sumOfDimMax = Object.values(score.detail_scores ?? {}).reduce((sum, dim) => {
		const max = (dim as DetailScoreCategory | undefined)?.max;
		return sum + (typeof max === "number" && Number.isFinite(max) && max > 0 ? max : 0);
	}, 0);
	if (sumOfDimMax > 0) return sumOfDimMax;
	return typeof score.total_score === "number" && score.total_score > 0 ? score.total_score : 100;
}
