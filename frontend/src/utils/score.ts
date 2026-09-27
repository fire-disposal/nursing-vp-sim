import type {
	EvidenceRef,
	ItemStatus,
	ScoreData,
	ScoreFallback,
	ScoreSource,
} from "@/types/score";

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
 * 展示分母（该次评分的满分）—— 唯一实现，学生页 / 教师页 / 评分卡共用。
 *
 * 口径 = 各**展示层**维度满分之和（rubric 维度权重之和，线上 = 100）。维度信息缺失或
 * 全为 0 时退回 `total_score`，再退回 100 分制默认值，保证分母不会为 0、也
 * 不会被显示成小于得分本身（不再使用无来源的 `+30` 兜底）。
 */
export function getScoreDenominator(score: ScoreData | null | undefined): number {
	if (!score) return 100;
	const sumOfDimMax = Object.values(score.detail_scores ?? {}).reduce((sum, dim) => {
		const max = dim?.max;
		return sum + (typeof max === "number" && Number.isFinite(max) && max > 0 ? max : 0);
	}, 0);
	if (sumOfDimMax > 0) return sumOfDimMax;
	return typeof score.total_score === "number" && score.total_score > 0 ? score.total_score : 100;
}

/**
 * 有效成绩（服务端 `effective_total` 优先）。
 *
 * 仅当历史行缺该字段时才按 COALESCE(reviewed_total, total_score) 回退 —— 与后端
 * 同一口径，前端不引入第二套取分规则。
 */
export function getEffectiveTotal(score: ScoreData | null | undefined): number | null {
	if (!score) return null;
	if (typeof score.effective_total === "number") return score.effective_total;
	if (typeof score.reviewed_total === "number") return score.reviewed_total;
	if (typeof score.total_score === "number") return score.total_score;
	return null;
}

/**
 * 有效成绩来源：优先服务端 `score.source`；历史行缺该字段时按同一优先级推导
 * （系统降级 > 教师复核 > AI 初评），不发明新的分级口径。
 */
export function resolveScoreSource(score: ScoreData | null | undefined): ScoreSource {
	if (!score) return "ai";
	if (score.source === "ai" || score.source === "review" || score.source === "fallback") {
		return score.source;
	}
	if (score.fallback) return "fallback";
	if (typeof score.reviewed_total === "number") return "review";
	return "ai";
}

/** 有效成绩来源文案（分数标题上必须写明这个分是谁给的） */
export const SCORE_SOURCE_LABELS: Record<ScoreSource, string> = {
	ai: "AI 初评",
	review: "教师复核",
	fallback: "系统降级",
};

/** 条目状态文案（原始层 `status`）—— 非 scored 的条目必须有显式说明，不留空档 */
const ITEM_STATUS_LABELS: Partial<Record<ItemStatus, string>> = {
	not_applicable: "本次不适用",
	unscored_by_model: "系统未判定",
};

export function itemStatusLabel(item: {
	status?: ItemStatus;
	score?: number | null;
}): string | null {
	if (item.status === "not_applicable") return ITEM_STATUS_LABELS.not_applicable ?? null;
	if (item.status === "unscored_by_model") return ITEM_STATUS_LABELS.unscored_by_model ?? null;
	// 无状态字段但分数为空：同样是"没有判定"，不能显示成 0 分
	if (item.score == null) return ITEM_STATUS_LABELS.unscored_by_model ?? null;
	return null;
}

/** 系统降级原因的中文说明（kind → 人话），用于降级横幅 */
const FALLBACK_KIND_LABELS: Record<string, string> = {
	llm_empty: "评分模型两次返回空结果，未能生成有效评分",
	llm_partial: "评分模型只返回了部分内容，其余维度缺失",
	dims_injected: "部分维度未能评分，已按规则补齐默认分",
	items_unscored: "部分条目未被模型判定",
	all_dims_injected: "所有维度都未能评分，已整体按规则补齐默认分",
	no_applicable_items: "本次没有可评条目（条目均被声明为本例不适用）",
};

export function fallbackKindLabel(fallback: ScoreFallback | null | undefined): string {
	const kind = fallback?.kind;
	if (!kind) return "评分结果不完整（原因未知）";
	return FALLBACK_KIND_LABELS[kind] ?? `评分结果不完整（${kind}）`;
}

/** 证据引用中的消息类引用（用于「跳到对话」——只有服务端定位成功的引用才给跳转） */
export function messageRefIds(refs: EvidenceRef[] | undefined): (number | string)[] {
	if (!Array.isArray(refs)) return [];
	return refs.filter((ref) => ref && ref.kind === "message" && ref.id != null).map((ref) => ref.id);
}
