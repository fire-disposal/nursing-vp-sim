import type { EmotionVector, PhoneEmotionLabel } from "./types";

/**
 * 四维情绪主导标签 —— 与后端情绪口径同序（先判负面，再判正向）。
 *
 * 顺序不是随意的：烦躁必须排在"焦虑但配合"前面，否则一个又烦又配合的人会被读成
 * "配合"，而电话那头听到的语气是反的。信任高但焦虑同样高时判 `trusting_anxious`，
 * 因为"信你但心里没底"和"放心交给你"对病人是两种完全不同的状态。
 */
export function dominantLabel(v: EmotionVector): PhoneEmotionLabel {
	if (v.irritation >= 0.62) return "irritated";
	if (v.irritation >= 0.45 && v.trust < 0.45) return "defensive";
	if (v.trust <= 0.25 && v.cooperation <= 0.35) return "withdrawn";
	if (v.anxiety >= 0.55 && v.cooperation >= 0.65) return "anxious_cooperative";
	if (v.anxiety >= 0.5) return v.trust >= 0.6 ? "trusting_anxious" : "anxious_guarded";
	if (v.trust >= 0.72 && v.anxiety < 0.4) return "open_trusting";
	if (v.trust >= 0.5 && v.irritation < 0.3) return "relaxed";
	return "neutral";
}

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);

/** 增量叠加并夹到 0..1。 */
export function applyDelta(v: EmotionVector, delta: Partial<EmotionVector>): EmotionVector {
	return {
		trust: clamp01(v.trust + (delta.trust ?? 0)),
		anxiety: clamp01(v.anxiety + (delta.anxiety ?? 0)),
		irritation: clamp01(v.irritation + (delta.irritation ?? 0)),
		cooperation: clamp01(v.cooperation + (delta.cooperation ?? 0)),
	};
}

/**
 * 向"基线"回弹一点点 —— 人会自然平复，电话里尤其明显。
 *
 * 强度很低（每轮 ≤ 2%）且不做二次回弹：状态机的可读性比仿真度重要，
 * 单测也要能按固定轮数算出确定值。
 */
export function drift(v: EmotionVector, baseline: EmotionVector, rate = 0.02): EmotionVector {
	const pull = (current: number, base: number) => clamp01(current + (base - current) * rate);
	return {
		trust: pull(v.trust, baseline.trust),
		anxiety: pull(v.anxiety, baseline.anxiety),
		irritation: pull(v.irritation, baseline.irritation),
		cooperation: pull(v.cooperation, baseline.cooperation),
	};
}

/** 维度键（展示顺序固定：信任 / 焦虑 / 烦躁 / 配合）。 */
export const EMOTION_DIMS = ["trust", "anxiety", "irritation", "cooperation"] as const;

export const EMOTION_DIM_LABELS: Record<(typeof EMOTION_DIMS)[number], string> = {
	trust: "信任",
	anxiety: "焦虑",
	irritation: "烦躁",
	cooperation: "配合",
};
