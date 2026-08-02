import type { Emotion4DLabel } from "@/stores/trainingStore";
import type { EmotionValues } from "./expressionMap";

/**
 * premiumExtras — 高级脸专属的情绪派生信号（在 FaceConfig 之上的附加通道）。
 *
 * 这些信号只服务于高级渲染（头倾角/汗滴/皱眉纹/虹膜朝向/眼睑压力），
 * 不进基础 FaceConfig 契约——基础脸保持简单，高级脸自由发挥。
 */

export interface PremiumExtras {
	/** 头倾角（度）：负 = 低头/消沉，正 = 微仰 */
	headTilt: number;
	/** 焦虑汗滴 */
	sweat: boolean;
	/** 眉间"11 字"皱眉纹 */
	furrow: boolean;
	/** 虹膜朝向：center / down(回避) / away(防御侧视) */
	irisShift: "center" | "down" | "away";
	/** 上睑额外下压 0..1（烦躁眯眼） */
	eyeLid: number;
}

export const NEUTRAL_EXTRAS: PremiumExtras = {
	headTilt: 0,
	sweat: false,
	furrow: false,
	irisShift: "center",
	eyeLid: 0,
};

const LABEL_EXTRAS: Record<Emotion4DLabel, Partial<PremiumExtras>> = {
	open_trusting: { headTilt: 1 },
	trusting_anxious: { headTilt: -1, sweat: true },
	irritated: { headTilt: -2.5, furrow: true, irisShift: "away", eyeLid: 0.55 },
	anxious_cooperative: { headTilt: -1.5, sweat: true },
	anxious_guarded: { headTilt: -2, sweat: true, irisShift: "down" },
	withdrawn: { headTilt: -4, irisShift: "down", eyeLid: 0.3 },
	defensive: { headTilt: 3, furrow: true, irisShift: "away", eyeLid: 0.45 },
	relaxed: { headTilt: 1 },
	neutral: {},
};

export function premiumExtrasFrom4D(label: Emotion4DLabel, v: EmotionValues): PremiumExtras {
	const base = LABEL_EXTRAS[label] ?? {};
	const extras: PremiumExtras = { ...NEUTRAL_EXTRAS, ...base };

	// 数值叠加：极值信号盖过标签默认
	if (v.anxiety >= 0.7) {
		extras.sweat = true;
	}
	if (v.irritation >= 0.7) {
		extras.furrow = true;
		extras.eyeLid = Math.max(extras.eyeLid, 0.5);
	}
	if (v.cooperation <= 0.3 && v.trust <= 0.3) {
		extras.irisShift = "away";
	}
	return extras;
}
