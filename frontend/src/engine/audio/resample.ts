/**
 * 重采样器——把 AudioWorklet 之外的 Float32 PCM 降到 16k 单声道 PCM16LE。
 *
 * 浏览器采集与麦克风状态判定共用同一条链路（见 `mic.ts`）；云 ASR 的音频只在这里
 * 变成字节，ASR 传输层（`asr/volcStream.ts`）不关心采样率转换。
 */

export const TARGET_SAMPLE_RATE = 16000;

/** 线性插值重采样：与 `public/pcm-capture-worklet.js` 同一套算法（单测两侧各一份）。 */
export class Resampler {
	private readonly step: number;
	private pos = 0;
	private prev = 0;

	constructor(sourceRate: number, targetRate: number = TARGET_SAMPLE_RATE) {
		this.step = targetRate > 0 ? sourceRate / targetRate : 1;
	}

	/** 首块输入沿用上一块的末样本（跨块插值），调用方无需自己拼接。 */
	push(input: Float32Array, out: Int16Array): number {
		let written = 0;
		let i = 0;
		while (i < input.length) {
			if (this.pos >= i) this.prev = i === 0 ? this.prev : input[i - 1];
			const index = Math.floor(this.pos);
			this.pos += this.step;
			if (index + 1 >= input.length) break;
			const frac = this.pos - index;
			const a = index < 0 ? this.prev : input[index];
			const b = input[index + 1];
			out[written++] = toPcm16(a + (b - a) * frac);
			i = index + 1;
		}
		this.pos -= input.length;
		if (this.pos < 0) this.pos = 0;
		this.prev = input[input.length - 1] ?? this.prev;
		return written;
	}

	reset(first = 0): void {
		this.pos = 0;
		this.prev = first;
	}
}

/** Float32（-1..1）→ PCM16LE 小端字节。 */
export function toPcm16(sample: number): number {
	const clamped = sample > 1 ? 1 : sample < -1 ? -1 : sample;
	return clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
}

export function floatToPcm16Bytes(samples: Float32Array): ArrayBuffer {
	const out = new DataView(new ArrayBuffer(samples.length * 2));
	for (let i = 0; i < samples.length; i += 1) out.setInt16(i * 2, toPcm16(samples[i]), true);
	return out.buffer;
}

/** 把一段设备采样率的音频整体降到 16k PCM16LE（按住模式收尾上传用）。 */
export function downsampleToPcm16(samples: Float32Array, sourceRate: number): ArrayBuffer {
	if (sourceRate === TARGET_SAMPLE_RATE) return floatToPcm16Bytes(samples);
	const count = Math.max(1, Math.round((samples.length * TARGET_SAMPLE_RATE) / sourceRate));
	const out = new Int16Array(count);
	const written = new Resampler(sourceRate).push(samples, out);
	return out.slice(0, written).buffer;
}
