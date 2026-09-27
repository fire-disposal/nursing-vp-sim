/**
 * 复核编辑器与 `POST /training/records/{id}/review` 之间的唯一转换点。
 *
 * 契约（docs/19 §4.2 第 6 条）：
 * - 编辑器读 `GET /review` 的 `original_raw_detail_scores`（原始刻度 0–`raw_scale`）；
 * - 提交的是**原始条目** `{dim: {score, items: [{id, name, score, max}]}}`，
 *   服务端按 rubric 丢弃未知条目、钳制越界分值、强制不适用条目为 null。
 *
 * `original_raw_detail_scores` 为 NULL 不是错误（历史记录按展示层反推，服务端用
 * `review_basis` 标明）：这里返回 null，编辑器据此给出「基准不是原始量尺」的警示。
 */

import type { ItemStatus, RawDetailScoreCategory, RawScoreItemData } from "@/types/score";

export interface RawReviewSubmitItem {
	id: string;
	name: string;
	score: number | null;
	max: number;
}

export type RawReviewSubmitPayload = Record<
	string,
	{ score: number; max: number; items: RawReviewSubmitItem[] }
>;

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 原始条目层 → 强类型视图；结构不可用时返回 null（调用方走「基准不可用」分支）。 */
export function toRawReviewDims(
	raw: unknown,
	rawScale: number,
): Record<string, RawDetailScoreCategory> | null {
	if (!isPlainObject(raw)) return null;
	const dims: Record<string, RawDetailScoreCategory> = {};
	for (const [dimName, dimRaw] of Object.entries(raw)) {
		if (!isPlainObject(dimRaw)) continue;
		const items: RawScoreItemData[] = [];
		for (const [index, itemRaw] of Object.entries(Array.isArray(dimRaw.items) ? dimRaw.items : [])) {
			if (!isPlainObject(itemRaw)) continue;
			const id = itemRaw.id == null ? `${dimName}:${index}` : String(itemRaw.id);
			const score = typeof itemRaw.score === "number" && Number.isFinite(itemRaw.score)
				? itemRaw.score
				: null;
			items.push({
				id,
				name: typeof itemRaw.name === "string" ? itemRaw.name : id,
				score,
				max: typeof itemRaw.max === "number" && itemRaw.max > 0 ? itemRaw.max : rawScale,
				status: typeof itemRaw.status === "string" ? (itemRaw.status as ItemStatus) : undefined,
				evidence: typeof itemRaw.evidence === "string" ? itemRaw.evidence : "",
				reason: typeof itemRaw.reason === "string" ? itemRaw.reason : "",
			});
		}
		if (items.length === 0) continue;
		const itemsTotal = items.reduce((sum, item) => sum + (item.score ?? 0), 0);
		dims[dimName] = {
			score:
				typeof dimRaw.score === "number" && Number.isFinite(dimRaw.score) ? dimRaw.score : itemsTotal,
			max: typeof dimRaw.max === "number" && dimRaw.max > 0 ? dimRaw.max : items.length * rawScale,
			items,
		};
	}
	return Object.keys(dims).length > 0 ? dims : null;
}

/**
 * 组装提交载荷：不适用条目提交 null（服务端也只接受 null），其余按教师所选值。
 *
 * 原样带回 `id`/`name`/`max` 是必要的——服务端用 `id` 判断该条目是否属于本 rubric，
 * 未知条目会被丢弃（不能凭提交抬高分母）。
 */
export function buildRawReviewPayload(
	dims: Record<string, RawDetailScoreCategory>,
	editedScores: Record<string, number>,
	notApplicableItems: readonly string[],
	rawScale: number,
): RawReviewSubmitPayload {
	const payload: RawReviewSubmitPayload = {};
	for (const [dimName, dim] of Object.entries(dims)) {
		const items: RawReviewSubmitItem[] = (dim.items ?? []).map((item) => {
			const itemId = String(item.id);
			const notApplicable =
				item.status === "not_applicable" || notApplicableItems.includes(itemId);
			const value = notApplicable ? null : (editedScores[itemId] ?? item.score);
			return {
				id: itemId,
				name: item.name,
				score: typeof value === "number" ? value : null,
				max: rawScale,
			};
		});
		payload[dimName] = {
			score: items.reduce((sum, item) => sum + (item.score ?? 0), 0),
			max: items.length * rawScale,
			items,
		};
	}
	return payload;
}

/** 复核基准说明：历史记录按展示层反推时不得假装原始量尺已知。 */
export function reviewBasisNotice(reviewBasis: string | null | undefined): string | null {
	if (reviewBasis === "legacy_display_derived") {
		return "该记录没有原始评分层（历史分），当前复核基准由展示分反推（非原始量尺）：分值与 AI 初评不是同一把尺，展示总分仅供参考。";
	}
	return null;
}
