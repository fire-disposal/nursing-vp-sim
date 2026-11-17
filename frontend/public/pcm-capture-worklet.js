/**
 * PCM 采集 worklet —— 麦克风 → 16kHz 单声道 PCM16LE。
 *
 * 放在 `public/` 是因为它必须在 AudioWorkletGlobalScope 里执行（没有 import、没有打包器）。
 * 重采样在这里做：浏览器给的是设备原生采样率（44.1k / 48k），云 ASR 只吃 16k；
 * 主线程逐样本重采样会跟 VAD 抢帧预算，所以放到音频线程。
 *
 * 协议：
 *   主线程 → 这里：`{type:"config", targetRate}` / `{type:"reset"}`
 *   这里 → 主线程：`{type:"pcm", buffer}`（ArrayBuffer，PCM16LE，已 transfer）
 *
 * 注册名必须与 `src/engine/audio/mic.ts` 的 `PCM_WORKLET_NAME` 一致。
 */
const PROCESSOR_NAME = "pcm-capture";
/** 每批上限（样本）：16kHz 下固定 50ms 一批，避免每 128 样本量子都发消息。 */
const MAX_CHUNK_SAMPLES = 800;

class PcmCaptureProcessor extends AudioWorkletProcessor {
	constructor() {
		super();
		this.targetRate = 16000;
		this.sourceRate = sampleRate;
		/** 输入侧每前进一个目标样本要消耗的输入样本数。 */
		this.step = this.sourceRate / this.targetRate;
		/** 下一个目标样本在"当前 + 下一块"里的位置（可为负 = 属于上一块）。 */
		this.pos = 0;
		/** 上一块的末样本（跨块插值的左端点）。 */
		this.lastSample = 0;
		this.chunk = new Int16Array(MAX_CHUNK_SAMPLES);
		this.chunkLen = 0;

		this.port.onmessage = (event) => {
			const data = event.data || {};
			if (data.type === "config" && typeof data.targetRate === "number" && data.targetRate > 0) {
				this.targetRate = data.targetRate;
				this.step = this.sourceRate / this.targetRate;
				this.reset();
			} else if (data.type === "reset") {
				this.reset();
			}
		};
	}

	reset() {
		this.pos = 0;
		this.chunkLen = 0;
	}

	emit(sample) {
		if (this.chunkLen === this.chunk.length) this.flush();
		this.chunk[this.chunkLen] = sample;
		this.chunkLen += 1;
	}

	flush() {
		if (this.chunkLen === 0) return;
		const out = this.chunk.slice(0, this.chunkLen);
		this.chunkLen = 0;
		this.port.postMessage({ type: "pcm", buffer: out.buffer }, [out.buffer]);
	}

	toPcm16(sample) {
		const clamped = sample > 1 ? 1 : sample < -1 ? -1 : sample;
		return clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
	}

	process(inputs) {
		const input = inputs[0];
		const channel = input && input.length > 0 ? input[0] : null;
		if (!channel || channel.length === 0) {
			// 没有输入（轨道静音/被禁用）：不补零，让云 ASR 自己按连续音频处理
			this.flush();
			return true;
		}

		while (this.pos < channel.length - 1) {
			const index = Math.floor(this.pos);
			const frac = this.pos - index;
			const a = index < 0 ? this.lastSample : channel[index];
			const b = channel[index + 1];
			this.emit(this.toPcm16(a + (b - a) * frac));
			this.pos += this.step;
		}
		this.pos -= channel.length;
		this.lastSample = channel[channel.length - 1];
		return true;
	}
}

registerProcessor(PROCESSOR_NAME, PcmCaptureProcessor);
