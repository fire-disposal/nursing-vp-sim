/**
 * PcmStreamPlayer — plays raw PCM 24kHz 16-bit mono chunks through Web Audio
 * with sample-accurate scheduling, so sentences chain gaplessly and the first
 * chunk is audible within ~50ms of arrival.
 */

const SAMPLE_RATE = 24000;

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
	const out = new Uint8Array(a.length + b.length);
	out.set(a, 0);
	out.set(b, a.length);
	return out;
}

export class PcmStreamPlayer {
	private ctx: AudioContext | null = null;
	/** 播放总线：全部分块先过这一个增益节点，再经 analyser 出声。 */
	private master: GainNode | null = null;
	private analyser: AnalyserNode | null = null;
	private endTime = 0;
	private sources = new Set<AudioBufferSourceNode>();
	/** 16kHz、按 performance.now() 对齐的十秒参考波形，供 ASR 反相抵消。 */
	private referencePcm = new Float32Array(16_000 * 10);
	private referenceStartMs = 0;
	private referenceWritten = 0;

	/** Create/resume the AudioContext. Returns a running context. */
	async prime(): Promise<AudioContext> {
		if (!this.ctx) {
			this.ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
			this.master = this.ctx.createGain();
			this.analyser = this.ctx.createAnalyser();
			this.analyser.fftSize = 1024;
			this.analyser.smoothingTimeConstant = 0.2;
			this.master.connect(this.analyser);
			this.analyser.connect(this.ctx.destination);
		}
		if (this.ctx.state !== "running") {
			await this.ctx.resume();
		}
		return this.ctx;
	}

	/** 包络分析节点：prime() 之后才存在（AudioContext 在首次出声时才创建）。 */
	get audioAnalyser(): AnalyserNode | null {
		return this.analyser;
	}

	get playing(): boolean {
		return this.ctx !== null && this.ctx.currentTime < this.endTime;
	}

	/** Resolves when the scheduled timeline has fully played out. */
	async waitIdle(): Promise<void> {
		if (!this.ctx) return;
		const remainMs = (this.endTime - this.ctx.currentTime) * 1000;
		if (remainMs > 0) {
			await new Promise((r) => setTimeout(r, remainMs));
		}
	}

	/**
	 * Read a PCM byte stream and schedule each chunk as it arrives.
	 * Returns bytes received; `onFirstChunk` fires once on the first audio.
	 */
	async playStream(
		stream: ReadableStream<Uint8Array>,
		onFirstChunk?: () => void,
	): Promise<number> {
		const ctx = await this.prime();
		const reader = stream.getReader();
		let leftover: Uint8Array | null = null;
		let bytes = 0;
		let firstFired = false;
		try {
			for (;;) {
				const { done, value } = await reader.read();
				if (done) break;
				if (!value?.length) continue;
				let buf: Uint8Array = leftover ? concat(leftover, value) : value;
				if (buf.length % 2) {
					leftover = buf.slice(buf.length - 1);
					buf = buf.slice(0, buf.length - 1);
				} else {
					leftover = null;
				}
				if (!buf.length) continue;
				bytes += buf.length;
				if (!firstFired) {
					firstFired = true;
					onFirstChunk?.();
				}
				const pcm = new Int16Array(buf.buffer, buf.byteOffset, buf.length / 2);
				const f32 = new Float32Array(pcm.length);
				for (let i = 0; i < pcm.length; i++) {
					f32[i] = (pcm[i] ?? 0) / 32768;
				}
				const audio = ctx.createBuffer(1, f32.length, SAMPLE_RATE);
				audio.copyToChannel(f32, 0);
				const src = ctx.createBufferSource();
				src.buffer = audio;
				src.connect(this.master ?? ctx.destination);
				const at = Math.max(ctx.currentTime + 0.05, this.endTime);
				src.start(at);
				this.appendReference(f32, at, SAMPLE_RATE);
				this.endTime = at + audio.duration;
				this.sources.add(src);
				src.onended = () => this.sources.delete(src);
			}
		} finally {
			reader.releaseLock();
		}
		return bytes;
	}

	/**
	 * 接通校准音：1kHz、7 位 Barker 开关包络。
	 * 前段测环境底噪，已知特征用于估计扬声器→麦克风的延迟和回授增益。
	 */
	async playConnectTone(): Promise<void> {
		const ctx = await this.prime();
		const sampleRate = ctx.sampleRate;
		// 300ms 环境采样 + 7 位 Barker 开关包络（90ms/bit）+ 500ms 收尾。
		const pattern = [1, 1, 1, 0, 0, 1, 0] as const;
		const segments = [
			{ freq: 0, ms: 300 },
			...pattern.map((on) => ({ freq: on ? 1000 : 0, ms: 90 })),
			{ freq: 0, ms: 500 },
		];
		const total = segments.reduce((sum, segment) => sum + Math.round((segment.ms / 1000) * sampleRate), 0);
		const buffer = ctx.createBuffer(1, total, sampleRate);
		const data = buffer.getChannelData(0);
		let cursor = 0;
		for (const segment of segments) {
			const length = Math.round((segment.ms / 1000) * sampleRate);
			const fade = Math.min(Math.round(sampleRate * 0.008), Math.floor(length / 2));
			for (let i = 0; i < length; i += 1) {
				if (segment.freq === 0) continue;
				const gain = Math.min(1, i / Math.max(1, fade), (length - i - 1) / Math.max(1, fade));
				data[cursor + i] = Math.sin((2 * Math.PI * segment.freq * i) / sampleRate) * 0.18 * gain;
			}
			cursor += length;
		}
		const src = ctx.createBufferSource();
		src.buffer = buffer;
		src.connect(this.master ?? ctx.destination);
		const at = Math.max(ctx.currentTime + 0.05, this.endTime);
		src.start(at);
		this.appendReference(data, at, sampleRate);
		this.endTime = at + buffer.duration;
		this.sources.add(src);
		await new Promise<void>((resolve) => {
			src.onended = () => {
				this.sources.delete(src);
				resolve();
			};
		});
	}

	/** 把调度到 AudioContext 时间线的波形重采样为 ASR 的 16kHz 参考。 */
	private appendReference(samples: Float32Array, atContextSeconds: number, sourceRate: number): void {
		if (!this.ctx || samples.length === 0) return;
		const startMs = performance.now() - this.ctx.currentTime * 1000 + atContextSeconds * 1000;
		if (this.referenceWritten === 0) this.referenceStartMs = startMs;
		const ratio = sourceRate / 16_000;
		const count = Math.floor(samples.length / ratio);
		const firstIndex = Math.round((startMs - this.referenceStartMs) * 16);
		for (let i = 0; i < count; i += 1) {
			const index = firstIndex + i;
			if (index < 0) continue;
			if (index >= this.referenceWritten + this.referencePcm.length) {
				this.referencePcm.fill(0);
				this.referenceWritten = index;
			}
			const position = i * ratio;
			const left = Math.floor(position);
			const right = Math.min(samples.length - 1, left + 1);
			const mix = position - left;
			this.referencePcm[index % this.referencePcm.length] = (samples[left] ?? 0) * (1 - mix) + (samples[right] ?? 0) * mix;
			this.referenceWritten = Math.max(this.referenceWritten, index + 1);
		}
	}

	/** 读取 performance.now() 时间轴上的参考样本；没有覆盖的区间返回静音。 */
	readReference(startMs: number, length: number): Float32Array {
		const out = new Float32Array(length);
		if (this.referenceWritten === 0) return out;
		const firstIndex = Math.round((startMs - this.referenceStartMs) * 16);
		for (let i = 0; i < length; i += 1) {
			const index = firstIndex + i;
			if (index < 0 || index >= this.referenceWritten) continue;
			if (index < this.referenceWritten - this.referencePcm.length) continue;
			out[i] = this.referencePcm[index % this.referencePcm.length] ?? 0;
		}
		return out;
	}

	/** 当前输出 RMS（0..1），供回声门判断麦克风能量是否来自本播放器。 */
	outputLevel(): number {
		const analyser = this.analyser;
		if (!analyser) return 0;
		const buffer = new Float32Array(analyser.fftSize);
		analyser.getFloatTimeDomainData(buffer);
		let sum = 0;
		for (let i = 0; i < buffer.length; i += 1) sum += buffer[i] * buffer[i];
		return Math.sqrt(sum / buffer.length);
	}

	stop(): void {
		for (const s of this.sources) {
			try {
				s.stop();
			} catch {
				/* already stopped */
			}
		}
		this.sources.clear();
		this.endTime = 0;
	}

	/**
	 * 释放 AudioContext。
	 *
	 * 浏览器对每页并发 AudioContext 有硬上限（Chrome ≈6），而每次进入训练页都会新建一个
	 * PcmStreamPlayer：只 stop 不 close 会在几次进出后静默失效（TTS 再也发不出声音），
	 * 并常驻音频线程内存。prime() 会按需重建，因此 dispose 后仍可安全复用。
	 */
	dispose(): void {
		this.stop();
		const ctx = this.ctx;
		this.ctx = null;
		this.master = null;
		this.analyser = null;
		this.referenceWritten = 0;
		this.referencePcm.fill(0);
		if (ctx && ctx.state !== "closed") {
			void ctx.close().catch(() => {
				/* already closing */
			});
		}
	}
}
