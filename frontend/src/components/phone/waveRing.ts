/** 固定容量时域环形缓冲：只保留最近 seconds 秒，旧样本被覆盖。 */
export class WaveRing {
	readonly samples: Float32Array;
	private writeIndex = 0;
	private filled = 0;

	constructor(seconds = 20, sampleRate = 16_000) {
		this.samples = new Float32Array(Math.max(1, Math.floor(seconds * sampleRate)));
	}

	get length(): number {
		return this.filled;
	}

	/** 追加一帧；每帧内部复制，调用方随后可释放源 PCM。 */
	push(values: Float32Array | Int16Array, scale = 1): void {
		for (let i = 0; i < values.length; i += 1) {
			this.samples[this.writeIndex] = (values[i] ?? 0) * scale;
			this.writeIndex = (this.writeIndex + 1) % this.samples.length;
			if (this.filled < this.samples.length) this.filled += 1;
		}
	}

	/** 距最新样本的偏移；0 = 最新，越大约老。 */
	get(offsetFromLatest: number): number {
		if (offsetFromLatest < 0 || offsetFromLatest >= this.filled) return 0;
		const index = (this.writeIndex - 1 - offsetFromLatest + this.samples.length) % this.samples.length;
		return this.samples[index] ?? 0;
	}
}
