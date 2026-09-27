/**
 * 成绩管理页的**数值分段标签**口径（docs/19 §4.2 第 8/9 条）。
 *
 * 阈值与标签的所有者是服务端等第政策：排名响应里的 `policy` / `summary.policy` 直接给出
 * `numeric_bands: [{band, min, label}]`、`numeric_band_description` 与能力等第可用性。
 * 这里只做一件事：把弱类型 policy dict 收口成 `GradePolicy`（唯一转换点）。
 *
 * **前端不持有 band id → 中文的映射**：服务端没给标签的 band 就只显示数值阈值，
 * 页面不自己起名（「好中差」/「优秀合格」这类词一律不出现），也不把数值分段说成能力等第。
 */

import type { GradePolicy, GradePolicyNumericBand } from "@/types/score";

/** 服务端未声明能力等第可用性时的说明文案（与服务端同一句话，不在页面各自改写）。 */
export const CAPABILITY_UNCALIBRATED_LABEL = "尚未校准能力等第";

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 弱类型 policy dict → `GradePolicy`；无可辨认内容时返回 null（不展示假政策）。 */
export function toGradePolicy(raw: unknown): GradePolicy | null {
	if (!isPlainObject(raw)) return null;
	const numericBands: GradePolicyNumericBand[] = [];
	if (Array.isArray(raw.numeric_bands)) {
		for (const entry of raw.numeric_bands) {
			if (!isPlainObject(entry)) continue;
			const band = typeof entry.band === "string" ? entry.band : "";
			const min = typeof entry.min === "number" && Number.isFinite(entry.min) ? entry.min : null;
			if (!band || min === null) continue;
			numericBands.push({
				band,
				min,
				label: typeof entry.label === "string" ? entry.label : band,
			});
		}
	}
	const hasPolicyFields =
		numericBands.length > 0 ||
		typeof raw.numeric_band_description === "string" ||
		raw.capability_available !== undefined ||
		typeof raw.capability_label === "string";
	if (!hasPolicyFields) return null;
	return {
		id: typeof raw.id === "string" ? raw.id : undefined,
		version: typeof raw.version === "number" ? raw.version : undefined,
		calibrated: raw.calibrated === true,
		capability_available: raw.capability_available === true,
		capability_label: typeof raw.capability_label === "string" ? raw.capability_label : null,
		capability_note: typeof raw.capability_note === "string" ? raw.capability_note : null,
		numeric_bands: numericBands,
		numeric_band_description:
			typeof raw.numeric_band_description === "string" ? raw.numeric_band_description : undefined,
	};
}

/**
 * band id → 服务端给的展示标签（例如「数值参考 · 高」）。
 * 服务端没有该 band 的标签时返回 null —— 宁可不标注，也不在客户端编一套分段名。
 */
export function bandLabel(band: string | null | undefined, policy: GradePolicy | null): string | null {
	if (!band) return null;
	return policy?.numeric_bands?.find((entry) => entry.band === band)?.label ?? null;
}

/** 由服务端阈值拼出的一句话（数字与标签全部来自 policy，前端不参与阈值计算）。 */
export function numericBandSummary(policy: GradePolicy | null): string | null {
	const bands = policy?.numeric_bands ?? [];
	if (bands.length === 0) return null;
	const parts = bands.map((entry) => `平均分 ≥ ${entry.min} 为「${entry.label}」`);
	const floor = bands[bands.length - 1].min;
	return `服务端数值参考阈值：${parts.join("，")}；低于 ${floor} 的记录不在上述分段内。`;
}

/** 未校准说明：只在服务端未声明「能力等第可用」时给出文案。 */
export function capabilityNotice(policy: GradePolicy | null): { label: string; note: string | null } | null {
	if (!policy) return null;
	if (policy.capability_available) return null;
	return {
		label: policy.capability_label ?? CAPABILITY_UNCALIBRATED_LABEL,
		note: policy.capability_note ?? null,
	};
}

/** 服务端可比性块：不同任务/量尺/辅助条件的记录不构成可比组，聚合只能作数值描述。 */
export interface ComparabilityView {
	singleGroup: boolean;
	mixed: boolean;
	identityUnknownCount: number;
	groups: { label: string; count: number }[];
}

/** 弱类型 comparability dict → `ComparabilityView`；无该块时返回 null（不猜可比性）。 */
export function toComparability(raw: unknown): ComparabilityView | null {
	if (!isPlainObject(raw)) return null;
	const groups: { label: string; count: number }[] = [];
	if (Array.isArray(raw.groups)) {
		for (const entry of raw.groups) {
			if (!isPlainObject(entry)) continue;
			const label = typeof entry.label === "string" ? entry.label : "";
			if (!label) continue;
			groups.push({ label, count: typeof entry.count === "number" ? entry.count : 0 });
		}
	}
	const hasFields =
		raw.single_group !== undefined || raw.mixed !== undefined || groups.length > 0;
	if (!hasFields) return null;
	return {
		singleGroup: raw.single_group === true,
		mixed: raw.mixed === true,
		identityUnknownCount:
			typeof raw.identity_unknown_count === "number" ? raw.identity_unknown_count : 0,
		groups,
	};
}
