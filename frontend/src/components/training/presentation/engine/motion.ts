/**
 * 表现层的动作数学 — 纯函数，全部只依赖 (t, seed, 输入)，无 DOM、无时间源。
 *
 * 这里只回答「这一帧的眨眼到什么程度、呼吸到哪、口张多大」，怎么画在 `draw.ts`。
 * 分开的原因：这些曲线是唯一值得测的东西（形状、周期、边界），而 canvas 像素测不了。
 */

import type { EmotionState } from "@/stores/trainingStore";

export interface MotionProfile {
	/** 静息呼吸周期（秒）。 */
	breathSeconds: number;
	/** 呼吸带来的整体起伏幅度（相对图高）。 */
	breathAmp: number;
	/** 头部左右摆动的最大角度（度）。 */
	swayDeg: number;
	/** 平均眨眼间隔（秒）。 */
	blinkSeconds: number;
	/** 说话时下颌最大下移（相对脸高）。 */
	jawOpen: number;
}

const PROFILES: Record<EmotionState, MotionProfile> = {
	withdrawn: { breathSeconds: 4.6, breathAmp: 0.006, swayDeg: 1.1, blinkSeconds: 4.4, jawOpen: 0.012 },
	defensive: { breathSeconds: 3.6, breathAmp: 0.008, swayDeg: 1.6, blinkSeconds: 3.4, jawOpen: 0.016 },
	anxious: { breathSeconds: 2.3, breathAmp: 0.013, swayDeg: 2.4, blinkSeconds: 2.6, jawOpen: 0.022 },
	neutral: { breathSeconds: 3.3, breathAmp: 0.009, swayDeg: 1.8, blinkSeconds: 3.6, jawOpen: 0.019 },
	relaxed: { breathSeconds: 3.8, breathAmp: 0.010, swayDeg: 1.5, blinkSeconds: 4.2, jawOpen: 0.018 },
	open: { breathSeconds: 3.0, breathAmp: 0.011, swayDeg: 2.2, blinkSeconds: 3.2, jawOpen: 0.021 },
};

export function profileFor(emotion: EmotionState): MotionProfile {
	return PROFILES[emotion] ?? PROFILES.neutral;
}

/** 0..1 的确定性伪随机（同一 seed + 序号永远同值，方便测试与截图对齐）。 */
export function hash01(n: number, seed = 0): number {
	const x = Math.sin(n * 127.1 + seed * 311.7) * 43758.5453;
	return x - Math.floor(x);
}

/** 眨眼波形：闭合 70 ms、全闭 55 ms、睁开 120 ms。 */
function blinkShape(p: number): number {
	if (p <= 0) return 0;
	if (p < 0.07) return p / 0.07;
	if (p < 0.125) return 1;
	if (p < 0.245) return 1 - (p - 0.125) / 0.12;
	return 0;
}

/**
 * 某一时刻的闭眼程度 0..1。间隔带抖动（人不会定时眨眼），约 1/4 的眨眼里夹一次双眨。
 * 用 floor(t/interval) 找当前与上一个窗口，保证跨窗口连续、无跳变。
 */
export function blinkAt(t: number, interval: number, seed = 0): number {
	const k = Math.floor(t / interval);
	let value = 0;
	for (const i of [k, k - 1]) {
		const start = i * interval + hash01(i, seed) * interval * 0.35;
		const p = t - start;
		if (p < 0 || p > 0.25) continue;
		value = Math.max(value, blinkShape(p));
		if (hash01(i * 7 + 3, seed) > 0.74) {
			const p2 = p - 0.33;
			if (p2 > 0 && p2 < 0.25) value = Math.max(value, blinkShape(p2));
		}
	}
	return value;
}

/** 呼吸相位 -1..1。 */
export function breathAt(t: number, seconds: number): number {
	return Math.sin((t / seconds) * Math.PI * 2);
}

/** 头部摆动 -1..1：两个不可通约的正弦叠加，看起来不像节拍器。 */
export function swayAt(t: number, seed = 0): number {
	const a = Math.sin(t * 0.37 + seed * 1.7);
	const b = Math.sin(t * 0.23 + seed * 4.1 + 1.3);
	// 权重和为 1，所以结果天然落在 -1..1（除以 0.9 会越界 11%，被测试抓到过）
	return a * 0.62 + b * 0.38;
}

/** 说话点头 -1..1：只在有包络时明显（句间静默收回到 0）。 */
export function nodAt(t: number, envelope: number, gain: number): number {
	return Math.sin(t * 4.1) * envelope * gain;
}

/** 指数趋近（attack/release 不对称）：包络与口型的滞后都用它，避免抖动。 */
export function approach(
	current: number,
	target: number,
	dt: number,
	upSeconds: number,
	downSeconds: number,
): number {
	const tau = target > current ? upSeconds : downSeconds;
	if (tau <= 0) return target;
	return current + (target - current) * (1 - Math.exp(-dt / tau));
}

/**
 * 口型：张口跟包络走，宽窄按约 7 次/秒的音节节奏抖一点——没有音素也要让嘴不是一块机械开合。
 * 返回 { open, wide }，分别喂给绘制的口高与口宽。
 */
export function mouthShapeAt(t: number, envelope: number, speaking: boolean): { open: number; wide: number } {
	const open = mouthTarget(speaking, envelope);
	const syllable = Math.floor(t * 7);
	return { open, wide: 0.9 + 0.2 * hash01(syllable, 3) };
}

/** 口型目标 0..1：说话时跟包络走，不说话时留下极小的静息口缝。 */
export function mouthTarget(speaking: boolean | undefined, envelope: number): number {
	const env = Math.min(1, Math.max(0, envelope));
	return speaking === true ? 0.32 + 0.68 * env : 0.04;
}
