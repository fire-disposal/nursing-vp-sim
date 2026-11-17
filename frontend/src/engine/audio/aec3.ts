import wasmUrl from "@ai-ecoverse/wasm-webrtc-audio-processing/webrtc-audio-processing.wasm?url";
import {
	instantiate,
	type CancellerStats,
	type EchoCanceller,
	type WebRtcAudioProcessing,
} from "@ai-ecoverse/wasm-webrtc-audio-processing";

let instance: WebRtcAudioProcessing | null = null;
let canceller: EchoCanceller | null = null;
let preparing: Promise<EchoCanceller> | null = null;

/** AEC3 只初始化一次；16k 是 ASR/采集现有采样率。 */
export async function prepareAec3(): Promise<EchoCanceller> {
	if (canceller) return canceller;
	if (preparing) return preparing;
	preparing = (async () => {
		const response = await fetch(wasmUrl);
		if (!response.ok) throw new Error(`AEC3 wasm HTTP ${response.status}`);
		const module = await WebAssembly.compile(await response.arrayBuffer());
		instance = instantiate(module);
		canceller = instance.create({ sampleRate: 16_000, noiseSuppression: false, vad: true });
		return canceller;
	})();
	try {
		return await preparing;
	} finally {
		preparing = null;
	}
}

export function getAec3(): EchoCanceller | null {
	return canceller;
}

export interface Aec3Frame {
	clean: Int16Array;
	stats: CancellerStats;
}

/** 输入 16k PCM16 与同一时间窗的 TTS 参考，输出 AEC3 消除后的 PCM。 */
export function processAec3(mic: Int16Array, reference: Float32Array): Aec3Frame | null {
	if (!canceller || mic.length === 0) return null;
	const micF32 = new Float32Array(mic.length);
	for (let i = 0; i < mic.length; i += 1) micF32[i] = (mic[i] ?? 0) / 32768;
	const cleanF32 = canceller.cancel(micF32, reference);
	const clean = new Int16Array(cleanF32.length);
	for (let i = 0; i < cleanF32.length; i += 1) {
		const value = Math.max(-1, Math.min(1, cleanF32[i] ?? 0));
		clean[i] = value < 0 ? Math.round(value * 32768) : Math.round(value * 32767);
	}
	return { clean, stats: canceller.stats() };
}

export type { CancellerStats };
