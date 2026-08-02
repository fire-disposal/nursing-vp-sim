import type { FaceConfig } from "@/components/training/face/expressionMap";
import type { PremiumExtras } from "@/components/training/face/premiumExtras";

/**
 * face-lab 动画实验 — 纯函数插值与缓动。
 *
 * 过渡语义：数值字段（browAngle/eyeOpenness/headTilt/eyeLid）线性插值，
 * 离散字段（mouth/eyeShape/blush/tears/sweat/furrow/irisShift）在 t=0.5 切换。
 * 全部纯函数，可单测；动画循环由 useAnimatedFace 驱动。
 */

export type EasingName = "linear" | "easeOut" | "easeInOut" | "back";

export const EASINGS: Record<EasingName, (t: number) => number> = {
	linear: (t) => t,
	easeOut: (t) => 1 - (1 - t) ** 3,
	easeInOut: (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2),
	back: (t) => {
		const c1 = 1.70158;
		const c3 = c1 + 1;
		return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
	},
};

export function interpolateFaceConfig(from: FaceConfig, to: FaceConfig, t: number): FaceConfig {
	return {
		browAngle: from.browAngle + (to.browAngle - from.browAngle) * t,
		eyeOpenness: from.eyeOpenness + (to.eyeOpenness - from.eyeOpenness) * t,
		eyeShape: t < 0.5 ? from.eyeShape : to.eyeShape,
		mouth: t < 0.5 ? from.mouth : to.mouth,
		blush: t < 0.5 ? from.blush : to.blush,
		tears: t < 0.5 ? from.tears : to.tears,
	};
}

export function interpolateExtras(from: PremiumExtras, to: PremiumExtras, t: number): PremiumExtras {
	return {
		headTilt: from.headTilt + (to.headTilt - from.headTilt) * t,
		sweat: t < 0.5 ? from.sweat : to.sweat,
		furrow: t < 0.5 ? from.furrow : to.furrow,
		irisShift: t < 0.5 ? from.irisShift : to.irisShift,
		eyeLid: from.eyeLid + (to.eyeLid - from.eyeLid) * t,
	};
}
