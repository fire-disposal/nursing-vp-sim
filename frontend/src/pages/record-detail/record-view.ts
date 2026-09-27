/**
 * 结果页（W5）记录级视图：再练习入口、关键选择、练习留痕。
 *
 * 后端这几个字段在 OpenAPI 生成类型里是 `dict[str, Any]` / `list[dict]`，此文件是它们
 * 唯一的边界转换点（与 `@/utils/score` 对 `score` 的处理同理）——组件不再各自断言形状。
 * 服务端是入口可用性的唯一裁决者：`available=false` 的入口**不渲染**，前端不猜原因。
 */

import type { EvidenceRef, RawScoreItemData } from "@/types/score";

/** 记录自身的练习留痕（`record.practice`）：本记录是某次复盘后的再练习 */
export interface PracticeMarker {
	kind?: string;
	purpose?: string;
	source_record_id?: number;
	revision_changed?: boolean;
}

/** 单个再练习入口（`record.practice_options.remediation|transfer`） */
export interface PracticeOption {
	available: boolean;
	label: string;
	case_id?: number;
	case_name?: string;
	/** 目标病例内容已更新（源记录钉住的 revision ≠ 当前 revision） */
	revision_changed?: boolean;
	message?: string;
	/** 不可用的机器可读原因（available=false 时存在） */
	reason?: string;
}

export interface PracticeOptions {
	remediation?: PracticeOption;
	transfer?: PracticeOption;
}

export type PracticeKind = "remediation" | "transfer";

/** 关键选择（W5）：少量最值得解释的条目，每条都能回到证据 */
export interface ReviewFocusItem {
	dimension: string;
	item_id: string;
	item_name: string;
	score: number;
	max: number;
	kind: "missed" | "partial" | string;
	key_omission: boolean;
	evidence: string;
	evidence_refs: EvidenceRef[];
	evidence_verified: boolean;
	reason: string;
	/** 「下次练习原则」——取自该条目已作者化的评分锚点 */
	principle: string;
	typical_error: string;
}

const PRACTICE_KIND_LABELS: Record<PracticeKind, string> = {
	remediation: "同例纠正练习",
	transfer: "变式迁移练习",
};

export function practiceKindLabel(kind: string | undefined): string {
	return kind === "transfer" || kind === "remediation" ? PRACTICE_KIND_LABELS[kind] : "再练习";
}

function asRecord(raw: unknown): Record<string, unknown> | null {
	return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
}

function toPracticeOption(raw: unknown, kind: PracticeKind): PracticeOption | null {
	const record = asRecord(raw);
	if (!record) return null;
	return {
		available: record.available === true,
		label: typeof record.label === "string" && record.label ? record.label : PRACTICE_KIND_LABELS[kind],
		case_id: typeof record.case_id === "number" ? record.case_id : undefined,
		case_name: typeof record.case_name === "string" ? record.case_name : undefined,
		revision_changed: record.revision_changed === true,
		message: typeof record.message === "string" ? record.message : undefined,
		reason: typeof record.reason === "string" ? record.reason : undefined,
	};
}

/** `record.practice_options` → 两个入口（服务端 label 优先，缺失时才用本地词表） */
export function toPracticeOptions(raw: unknown): PracticeOptions | null {
	const record = asRecord(raw);
	if (!record) return null;
	const remediation = toPracticeOption(record.remediation, "remediation");
	const transfer = toPracticeOption(record.transfer, "transfer");
	if (!remediation && !transfer) return null;
	return { remediation: remediation ?? undefined, transfer: transfer ?? undefined };
}

export function toPracticeMarker(raw: unknown): PracticeMarker | null {
	const record = asRecord(raw);
	if (!record || !record.kind) return null;
	return {
		kind: typeof record.kind === "string" ? record.kind : undefined,
		purpose: typeof record.purpose === "string" ? record.purpose : undefined,
		source_record_id: typeof record.source_record_id === "number" ? record.source_record_id : undefined,
		revision_changed: record.revision_changed === true,
	};
}

function toEvidenceRefs(raw: unknown): EvidenceRef[] {
	if (!Array.isArray(raw)) return [];
	return raw.flatMap((entry) => {
		const ref = asRecord(entry);
		if (!ref || typeof ref.kind !== "string" || ref.id == null) return [];
		return [
			{
				kind: ref.kind as EvidenceRef["kind"],
				id: ref.id as number | string,
				role: typeof ref.role === "string" ? ref.role : undefined,
				action: typeof ref.action === "string" ? ref.action : undefined,
			},
		];
	});
}

function toReviewFocusItem(raw: unknown): ReviewFocusItem | null {
	const record = asRecord(raw);
	if (!record || typeof record.score !== "number") return null;
	return {
		dimension: typeof record.dimension === "string" ? record.dimension : "",
		item_id: typeof record.item_id === "string" ? record.item_id : String(record.item_id ?? ""),
		item_name: typeof record.item_name === "string" ? record.item_name : "",
		score: record.score,
		max: typeof record.max === "number" ? record.max : 2,
		kind: typeof record.kind === "string" ? record.kind : "partial",
		key_omission: record.key_omission === true,
		evidence: typeof record.evidence === "string" ? record.evidence : "",
		evidence_refs: toEvidenceRefs(record.evidence_refs),
		evidence_verified: record.evidence_verified === true,
		reason: typeof record.reason === "string" ? record.reason : "",
		principle: typeof record.principle === "string" ? record.principle : "",
		typical_error: typeof record.typical_error === "string" ? record.typical_error : "",
	};
}

/** `record.review_focus` → 关键选择列表（丢弃形状不完整的条目，不补默认结论） */
export function toReviewFocus(raw: unknown): ReviewFocusItem[] {
	if (!Array.isArray(raw)) return [];
	return raw.map(toReviewFocusItem).filter((item): item is ReviewFocusItem => item !== null);
}

/** 逐项判定的来源（服务端给定，前端不推导）：这一行是 AI 判的还是教师判的 */
export type ItemJudgementSource = "ai" | "review";

/**
 * `score.review.detail_scores`（教师复核的**原始条目层**）→ 逐项行视图。
 *
 * 服务端契约（backend `sanitize_review_raw`）：复核层是原始刻度条目
 * `{维度: {score, items: [{id, name, score|null, max}]}}`，条目上没有 evidence/reason，
 * `score === null` 只出现在病例声明「本次不适用」的条目上（非数值分被服务端收敛为 0，
 * `max` 恒等于当时的 `raw_scale`）。
 *
 * 空对象 / 形状不符 → null：调用方此时**必须**退回 AI 初评层，绝不能把 AI 判定说成教师判定。
 */
export function toTeacherItemJudgements(raw: unknown): Record<string, RawScoreItemData[]> | null {
	const record = asRecord(raw);
	if (!record) return null;
	const dims: Record<string, RawScoreItemData[]> = {};
	for (const [dimName, dimRaw] of Object.entries(record)) {
		const dim = asRecord(dimRaw);
		if (!dim || !Array.isArray(dim.items)) continue;
		const items: RawScoreItemData[] = [];
		for (const [index, itemRaw] of dim.items.entries()) {
			const item = asRecord(itemRaw);
			if (!item) continue;
			const id = item.id == null ? `${dimName}:${index}` : String(item.id);
			const rawScore = item.score;
			const score =
				typeof rawScore === "number" && Number.isFinite(rawScore) ? rawScore : null;
			items.push({
				id,
				name: typeof item.name === "string" && item.name ? item.name : id,
				score,
				max: typeof item.max === "number" && item.max > 0 ? item.max : undefined,
				// 复核层不存 status：服务端只写数值或 null（病例声明「本次不适用」）；
				// 其余形状按「未判定」呈现，不冒充 0 分，也不冒充「本次不适用」
				status:
					score != null ? "scored" : rawScore === null ? "not_applicable" : "unscored_by_model",
			});
		}
		if (items.length > 0) dims[dimName] = items;
	}
	return Object.keys(dims).length > 0 ? dims : null;
}
