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

function smooth01(value: number): number {
	const p = Math.min(1, Math.max(0, value));
	return p * p * (3 - 2 * p);
}

/** 眨眼波形：闭合 70 ms、全闭 55 ms、睁开 120 ms；两端有速度过渡。 */
function blinkShape(p: number): number {
	if (p <= 0) return 0;
	if (p < 0.07) return smooth01(p / 0.07);
	if (p < 0.125) return 1;
	if (p < 0.245) return 1 - smooth01((p - 0.125) / 0.12);
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

/** 一次偏头的目标；接近一半的窗口保持原位，动作之间有明显停顿。 */
function swayTarget(k: number, seed: number): number {
	if (hash01(k * 5 + 1, seed) < 0.46) return 0;
	return (hash01(k * 5 + 2, seed) * 2 - 1) * 0.8;
}

/** 头部摆动 -1..1：停 1.8s → 缓动 1.6s → 停到下一窗口，边界连续。 */
export function swayAt(t: number, seed = 0): number {
	const period = 6.4;
	const k = Math.floor(t / period);
	const local = t - k * period;
	const from = swayTarget(k - 1, seed);
	const to = swayTarget(k, seed);
	return from + (to - from) * smooth01((local - 1.8) / 1.6);
}

/** 眼神在一个注视点停留，窗口开头用 180ms 移到下一点。 */
function gazeAxisAt(t: number, seed: number, salt: number): number {
	const period = 3.1;
	const k = Math.floor(t / period);
	const local = t - k * period;
	const target = (i: number) => {
		if (hash01(i * 7 + salt, seed) < 0.34) return 0;
		return (hash01(i * 7 + salt + 1, seed) * 2 - 1) * 0.75;
	};
	const from = target(k - 1);
	const to = target(k);
	return from + (to - from) * smooth01(local / 0.18);
}

export function gazeXAt(t: number, seed = 0): number {
	return gazeAxisAt(t, seed + 17, 3);
}

export function gazeYAt(t: number, seed = 0): number {
	return gazeAxisAt(t, seed + 29, 11) * 0.45;
}

/** 说话点头 -1..1：较弱包络只动口，较清晰的语句重音才带轻微点头。 */
export function nodAt(t: number, envelope: number, gain: number): number {
	const energy = Math.max(0, (envelope - 0.2) / 0.8);
	return (Math.sin(t * 2.6) * 0.65 + Math.sin(t * 1.3 + 0.8) * 0.35) * energy * gain;
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
 * 口型帧 —— 不插值，到点直接切。
 *
 * 动森/Mii 那种「说话」是一组离散嘴型按音节硬切，不是连续缩放：连续缩放看起来像鱼鳃，
 * 而且每一帧的嘴形都是半开不张的糊状。这里定义四个形态，按约 7 次/秒的音节钟切换，
 * 由包络决定切到多大的嘴，音节边界用确定性随机决定偶尔闭一下（辅音/换气的缝）。
 */
export type MouthShape = "closed" | "small" | "mid" | "wide";

/**
 * 某一时刻该画哪张嘴。width 是口宽倍率（同一形态下也有胖瘦差，避免每帧一模一样）。
 * 无包络或没在说话 → closed。
 */
export function mouthFrameAt(
	t: number,
	envelope: number,
	speaking: boolean,
): { shape: MouthShape; width: number } {
	const env = Math.min(1, Math.max(0, envelope));
	if (speaking !== true || env < 0.07) return { shape: "closed", width: 1 };

	const tick = Math.floor(t * 7);
	const width = 0.92 + 0.16 * hash01(tick, 5);
	// 约 1/7 的音节是闭口（辅音、换气）
	if (hash01(tick, 11) < 0.14) return { shape: "closed", width };
	// 音量定基准档，再按音节上下抖一档——不然音量平稳时嘴会在同一张脸上钉住
	const base = env < 0.3 ? 0 : env < 0.6 ? 1 : 2;
	const shift = hash01(tick, 23) < 0.35 ? (hash01(tick, 29) < 0.5 ? -1 : 1) : 0;
	const level = Math.min(2, Math.max(0, base + shift));
	return { shape: (["small", "mid", "wide"] as const)[level], width };
}

/** 口型目标 0..1：说话时跟包络走，不说话时留下极小的静息口缝。 */
export function mouthTarget(speaking: boolean | undefined, envelope: number): number {
	const env = Math.min(1, Math.max(0, envelope));
	return speaking === true ? 0.32 + 0.68 * env : 0.04;
}
