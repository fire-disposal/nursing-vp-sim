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
	private endTime = 0;
	private sources = new Set<AudioBufferSourceNode>();

	/** Create/resume the AudioContext. Call from a user-gesture path. */
	prime(): void {
		if (!this.ctx) {
			this.ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
		}
		if (this.ctx.state === "suspended") {
			void this.ctx.resume();
		}
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
		this.prime();
		const ctx = this.ctx;
		if (ctx?.state !== "running") {
			throw new Error("AudioContext unavailable");
		}
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
				src.connect(ctx.destination);
				const at = Math.max(ctx.currentTime + 0.05, this.endTime);
				src.start(at);
				this.endTime = at + audio.duration;
				this.sources.add(src);
				src.onended = () => this.sources.delete(src);
			}
		} finally {
			reader.releaseLock();
		}
		return bytes;
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
}
