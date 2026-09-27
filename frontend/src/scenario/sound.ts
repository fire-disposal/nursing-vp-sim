import { useEffect, useRef, useState } from "react";

/**
 * 设备提示音——**低频、克制、默认静音**。
 *
 * 三条底线（写死在实现里，不交给调用方）：
 * 1. 默认不出声：只有学生显式打开开关后才可能响；偏好记在 localStorage。
 * 2. 绝不高频报警：正弦短音（40ms）、峰值增益 0.04，节奏按**最差**通道状态放慢到
 *    3.0s（正常）/ 2.0s（偏低偏高）/ 1.2s（危急）——比常见监护仪的报警慢得多。
 * 3. 不响的时候真的不占资源：标签页隐藏即暂停，组件卸载即停止并释放 AudioContext
 *    （整块控制台只建一个 AudioContext：每次换状态都新建会很快撞上浏览器的上下文上限）。
 *
 * 声音**不是**警报语义：危急只改音调高低与节奏，不改变"这是提示"的性质。
 */

export const SOUND_PREF_KEY = "scenario-device-sound";

const TONE_HZ: Record<string, number> = {
	normal: 700,
	low: 780,
	high: 780,
	critical: 880,
	unknown: 700,
};

const PACE_MS: Record<string, number> = {
	normal: 3000,
	low: 2000,
	high: 2000,
	critical: 1200,
	unknown: 3000,
};

const BEEP_SECONDS = 0.04;
const PEAK_GAIN = 0.04;

/** 最差状态决定节奏与音调（危急 > 偏高/偏低 > 正常）。没有通道 = 不响。 */
export function worstStatus(statuses: string[]): string | null {
	const order = ["critical", "high", "low", "normal", "unknown"];
	return order.find((item) => statuses.includes(item)) ?? null;
}

/** 该状态下的提示间隔（毫秒）；没有状态返回 `null`（不响）。 */
export function beepPaceMs(status: string | null): number | null {
	if (status === null) return null;
	return PACE_MS[status] ?? PACE_MS.unknown;
}

/** 学生是否开过声音（默认关）。读取失败一律当关——宁可不出声。 */
export function readSoundEnabled(): boolean {
	try {
		return localStorage.getItem(SOUND_PREF_KEY) === "1";
	} catch {
		return false;
	}
}

export function writeSoundEnabled(enabled: boolean): void {
	try {
		localStorage.setItem(SOUND_PREF_KEY, enabled ? "1" : "0");
	} catch {
		// 私密模式/配额满：记不住偏好不影响"默认静音"这条底线
	}
}

/** 音频后端：拿不到就返回 null（静默降级，不造假音）。测试用 `__setAudioBackendForTests` 替换。 */
type AudioBackend = () => AudioContext | null;

function webAudioContext(): AudioContext | null {
	if (typeof window === "undefined") return null;
	const Ctor =
		window.AudioContext ??
		(window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
	if (!Ctor) return null;
	try {
		return new Ctor();
	} catch {
		return null;
	}
}

let audioBackend: AudioBackend = webAudioContext;

/** 只给测试用：换掉音频后端。 */
export function __setAudioBackendForTests(backend: AudioBackend): void {
	audioBackend = backend;
}

/**
 * 在给定上下文上按节奏滴滴；返回停止函数。
 *
 * 每次滴是一个独立的 40ms oscillator，不排队、不叠加——即使节奏被判错也不会连成连续音。
 */
export function startBeeping(
	ctx: AudioContext,
	{ paceMs, hz }: { paceMs: number; hz: number },
): () => void {
	const beep = () => {
		const osc = ctx.createOscillator();
		const gain = ctx.createGain();
		osc.type = "sine";
		osc.frequency.value = hz;
		gain.gain.value = PEAK_GAIN;
		osc.connect(gain);
		gain.connect(ctx.destination);
		osc.start(ctx.currentTime);
		osc.stop(ctx.currentTime + BEEP_SECONDS);
	};

	// 已经解锁才真的出声；suspended 时先尝试解锁，失败就静默（不重试、不报错）
	if (ctx.state === "suspended") void ctx.resume();
	beep();
	const timer = window.setInterval(beep, paceMs);

	return () => window.clearInterval(timer);
}

/**
 * 设备提示音的 React 接线：开关/节奏/可见性变化时重建节奏；卸载时停止并释放上下文。
 *
 * `enabled` 必须来自学生的显式开关（调用方负责持久化），这里不做任何"自动开启"。
 */
export function useDeviceSound(enabled: boolean, statuses: string[]) {
	const status = worstStatus(statuses);
	const paceMs = beepPaceMs(status);
	const hz = TONE_HZ[status ?? "unknown"];
	const [hidden, setHidden] = useState(
		() => typeof document !== "undefined" && document.hidden,
	);
	const contextRef = useRef<AudioContext | null>(null);

	useEffect(() => {
		const onVisibility = () => setHidden(document.hidden);
		document.addEventListener("visibilitychange", onVisibility);
		return () => document.removeEventListener("visibilitychange", onVisibility);
	}, []);

	useEffect(() => {
		if (!enabled || paceMs === null || hidden) return;
		if (contextRef.current === null) contextRef.current = audioBackend();
		const ctx = contextRef.current;
		if (ctx === null) return;
		return startBeeping(ctx, { paceMs, hz });
	}, [enabled, paceMs, hz, hidden]);

	// 卸载：停止（上面的清理）之外，把上下文也关掉——不留下悬空的音频资源
	useEffect(
		() => () => {
			contextRef.current?.close().catch(() => {});
			contextRef.current = null;
		},
		[],
	);
}
