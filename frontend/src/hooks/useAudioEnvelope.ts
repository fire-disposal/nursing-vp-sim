import { useEffect, useState } from "react";

/**
 * useAudioEnvelope — 音频包络 0..1（约 30Hz），供表现层做"嘴部随声音张合"。
 *
 * 输入可以是正在播放的 `<audio>/<video>` 元素，也可以是任意 AudioNode（M3 接训练链路时
 * 挂 PcmStreamPlayer 的 AnalyserNode 一侧）。纯浏览器 Web Audio + rAF，无新依赖：
 *   - 元素走 `MediaElementAudioSourceNode`，**元素的声音会改由 Web Audio 输出**（先经
 *     analyser 再到 destination），因此不会静音；
 *   - AudioNode 只旁路分析，经 0 增益节点接 destination 保证图被拉取，不会二次出声。
 *
 * 输出是"包络数值"，不是音素：火山 TTS 没有 viseme 时间戳，逐字口型做不到。
 */

/**
 * 归一化增益：实测 4 条测试音频的 30ms 窗 RMS 为 p50 0.027–0.054 / p90 0.084–0.131 /
 * max 0.16–0.25。乘 7 让正常音节落在 0.2–0.9（闭口段接近 0），静音段自然归零。
 */
const RMS_TO_UNIT = 7;
/** 采样间隔：约 30Hz（再快只是重复渲染，不增加信息）。 */
const SAMPLE_INTERVAL_MS = 1000 / 30;
/** 起落平滑系数：够快跟得上音节，又不会让嘴部逐帧抖动。 */
const SMOOTHING = 0.35;
/** 小于这个变化不提交状态，避免 30Hz 空转重渲染。 */
const MIN_STATE_DELTA = 0.008;

export type EnvelopeSource = HTMLMediaElement | AudioNode;

interface ElementChain {
	ctx: AudioContext;
	analyser: AnalyserNode;
}

/** AudioNode 旁路链：拿到 analyser，并在卸载时拆掉自己加的连线。 */
interface AuditedNodeChain {
	ctx: AudioContext;
	analyser: AnalyserNode;
	detach: () => void;
}

/**
 * 同一元素只能被 `createMediaElementSource` 抓取一次（重复/跨 context 会抛
 * InvalidStateError），因此按元素缓存 context 与 analyser 并**不 close**：
 * 每次进来都新建 context 会在 React 严格模式/热更新下把元素永久占住。
 * 缓存的生命周期等于页面里的元素数量（陈列台 1 个），不是每个组件实例一个。
 */
const elementChains = new WeakMap<HTMLMediaElement, ElementChain>();

function isMediaElement(source: EnvelopeSource): source is HTMLMediaElement {
	return typeof HTMLMediaElement !== "undefined" && source instanceof HTMLMediaElement;
}

function getElementChain(el: HTMLMediaElement): ElementChain | null {
	const cached = elementChains.get(el);
	if (cached) return cached;
	const Ctor =
		typeof window === "undefined"
			? undefined
			: (window.AudioContext ??
				(window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext);
	if (!Ctor) return null;
	const ctx = new Ctor();
	const analyser = ctx.createAnalyser();
	analyser.fftSize = 1024;
	analyser.smoothingTimeConstant = 0.2;
	const src = ctx.createMediaElementSource(el);
	src.connect(analyser);
	analyser.connect(ctx.destination);
	const chain: ElementChain = { ctx, analyser };
	elementChains.set(el, chain);
	return chain;
}

/** AudioNode 分支：旁路分析，不改变原有的出声路由。 */
function attachNode(source: AudioNode): AuditedNodeChain {
	const ctx = source.context as AudioContext;
	const analyser = ctx.createAnalyser();
	analyser.fftSize = 1024;
	analyser.smoothingTimeConstant = 0.2;
	const silent = ctx.createGain();
	silent.gain.value = 0;
	source.connect(analyser);
	analyser.connect(silent);
	silent.connect(ctx.destination);
	return {
		ctx,
		analyser,
		detach() {
			try {
				source.disconnect(analyser);
			} catch {
				/* 已断开 */
			}
			try {
				analyser.disconnect(silent);
				silent.disconnect(ctx.destination);
			} catch {
				/* 已断开 */
			}
		},
	};
}

export function useAudioEnvelope(source: EnvelopeSource | null): number {
	const [envelope, setEnvelope] = useState(0);

	useEffect(() => {
		if (!source) {
			setEnvelope(0);
			return;
		}

		const media = isMediaElement(source) ? source : null;
		let ctx: AudioContext;
		let analyser: AnalyserNode;
		let detach: (() => void) | null = null;
		if (media) {
			const chain = getElementChain(media);
			if (!chain) {
				setEnvelope(0);
				return;
			}
			ctx = chain.ctx;
			analyser = chain.analyser;
		} else {
			const nodeChain = attachNode(source as AudioNode);
			ctx = nodeChain.ctx;
			analyser = nodeChain.analyser;
			detach = nodeChain.detach;
		}
		const buf = new Float32Array(analyser.fftSize);
		let value = 0;
		let lastSample = 0;
		let raf = 0;
		let stopped = false;

		const tick = (now: number) => {
			if (stopped) return;
			raf = requestAnimationFrame(tick);
			if (now - lastSample < SAMPLE_INTERVAL_MS) return;
			lastSample = now;

			// 不播/静音时直接归零：analyser 读尾巴会让嘴部在停播后还动一下。
			if (media && (media.paused || media.muted || media.volume === 0)) {
				value = 0;
				setEnvelope(0);
				return;
			}
			if (ctx.state === "suspended") void ctx.resume();

			analyser.getFloatTimeDomainData(buf);
			let sum = 0;
			for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
			const target = Math.min(1, Math.sqrt(sum / buf.length) * RMS_TO_UNIT);
			value += (target - value) * SMOOTHING;
			const next = Math.round(value * 1000) / 1000;
			setEnvelope((prev) => (Math.abs(prev - next) < MIN_STATE_DELTA ? prev : next));
		};

		raf = requestAnimationFrame(tick);
		return () => {
			stopped = true;
			cancelAnimationFrame(raf);
			detach?.();
			// 元素的 context 故意不关：见 elementChains 的注释。
		};
	}, [source]);

	return envelope;
}
