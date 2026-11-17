/**
 * 麦克风采集链路 —— 一条 MediaStream + 一个 AudioContext，同时喂给三件事：
 * PCM 转发（云 ASR）、麦克风活跃度（患者说话时判断学生是否开口）、VAD（复用同一条流）。
 *
 * 为什么不能各开各的：`getUserMedia` 每次调用都是一条独立流、一个独立音频图。
 * VAD 自己开一条、PCM 再开一条的做法会让 `pauseStream` 停掉 VAD 的轨道而 PCM 那条
 * 仍在跑（或者反过来），并且同一台麦克风被两条回采链叠加处理，AEC 会失效、资源翻倍。
 *
 * 回采（AEC）：麦克风在浏览器内部就会减掉本页正在播放的声音；但云 ASR / Web Speech
 * 拿到的是**处理前**的音频时，患者的 TTS 可能被当成学生说话。所以这里额外测一次
 * "麦克风里有多少是患者的声音"——见 `EchoGate`。
 */
import { downsampleToPcm16, Resampler, TARGET_SAMPLE_RATE } from "./resample";

export const PCM_WORKLET_NAME = "pcm-capture";
/** worklet 设备初始化失败的兜底：直接用 ScriptProcessor 重采样（旧内核/被策略禁用）。 */
const SCRIPT_PROCESSOR_SIZE = 4096;
/**
 * 回采判据：麦克风能量落在参考能量的 [0.45, 2.5) 倍之间就算"主要是患者的声音"。
 * 上限不能少：学生近距离说话会比回放还响，那必须放行，否则学生永远打断不了。
 */
const ECHO_RATIO_MIN = 0.45;
const ECHO_RATIO_MAX = 2.5;
const ECHO_ABS_MIN = 0.0025;
const ECHO_CALIBRATION_MS = 1800;
const ECHO_CALIBRATION_MIN_SAMPLES = 12;
/** 校准完成前也按常见声学延迟取参考，避免拿“当前帧”对“已到麦克风的旧回声”。 */
const ECHO_FALLBACK_DELAY_MS = 120;

export interface MicCaptureConstraintsOptions {
	deviceId?: string;
}

/** 采集约束：单声道 + 三重 DSP 全开（回采/降噪/自动增益），云 ASR 只吃 16k 单声道。 */
export function micConstraints(options: MicCaptureConstraintsOptions = {}): MediaStreamConstraints {
	const audio: MediaTrackConstraints = {
		channelCount: 1,
		echoCancellation: true,
		noiseSuppression: true,
		autoGainControl: true,
	};
	if (options.deviceId) audio.deviceId = { exact: options.deviceId };
	return { audio, video: false };
}

export interface MicCaptureHandlers {
	/** 16k 单声道 PCM16LE（已重采样）。 */
	onPcm?: (pcm: ArrayBuffer) => void;
}

/** worklet 端口消息 → 纯 PCM 字节（形状不对就丢弃，不把脏数据塞进 ASR）。 */
function pcmSink(onPcm: ((pcm: ArrayBuffer) => void) | undefined): ((data: unknown) => void) | null {
	if (!onPcm) return null;
	return (data: unknown) => {
		const message = data as { type?: string; buffer?: ArrayBuffer } | null;
		if (message?.type !== "pcm" || !(message.buffer instanceof ArrayBuffer)) return;
		onPcm(message.buffer);
	};
}

/** 一路分叉：设备采样率 PCM 的 RMS 累计到 `levels`。 */
function rms(channel: Float32Array): number {
	let sum = 0;
	for (let i = 0; i < channel.length; i += 1) sum += channel[i] * channel[i];
	return Math.sqrt(sum / Math.max(1, channel.length));
}

/**
 * 回声门：用患者 TTS 的参考电平判断"麦克风里听到的到底是学生还是患者"。
 * 患者没在出声时一律放行；出声且麦克风能量远低于参考时也不放行（那是静音/环境噪声），
 * 只有两者接近才判定为回声。纯逻辑、无浏览器 API，可直接单测。
 */
export class EchoGate {
	private reference = 0;
	private gain: number | null = null;
	private delayMs = 0;
	private calibrating = false;
	private calibrationUntil = 0;
	/** 50ms 帧的参考/麦克风时间序列；用于估延迟与延迟对齐后的增益。 */
	private refHistory: Array<{ t: number; level: number }> = [];
	private micHistory: Array<{ t: number; level: number }> = [];

	/** 在首次 TTS 播放、环境安静时调用；1.8 秒内估计延迟与中位回授增益。 */
	beginCalibration(now = performance.now()): void {
		this.refHistory = [];
		this.micHistory = [];
		this.calibrating = true;
		this.calibrationUntil = now + ECHO_CALIBRATION_MS;
	}

	get calibrated(): boolean {
		return this.gain !== null;
	}

	/** 当前校准得到的声学延迟（ms），调试/观测用。 */
	get delay(): number {
		return this.delayMs;
	}

	setReference(level: number, now = performance.now()): void {
		const next = Number.isFinite(level) && level > 0 ? level : 0;
		if (next >= ECHO_ABS_MIN && this.reference < ECHO_ABS_MIN && !this.calibrating && this.gain === null) {
			this.beginCalibration(now);
		}
		this.reference = next;
		this.refHistory.push({ t: now, level: next });
		const cutoff = now - 10_000;
		while (this.refHistory.length > 0 && this.refHistory[0].t < cutoff) this.refHistory.shift();
	}

	/** 每 50ms 的麦克风帧：校准期同时记录，结束前做延迟互相关。 */
	observe(micLevel: number, now = performance.now()): void {
		this.micHistory.push({ t: now, level: micLevel });
		const cutoff = now - 5_000;
		while (this.micHistory.length > 0 && this.micHistory[0].t < cutoff) this.micHistory.shift();
		if (!this.calibrating) return;
		if (now >= this.calibrationUntil || this.micHistory.length >= 60) this.finishCalibration(now);
	}

	/** 取参考序列中离指定时间最近的帧；超出 120ms 视为缺失。 */
	private refAt(time: number): number | null {
		let best: { t: number; level: number } | null = null;
		for (const item of this.refHistory) {
			if (best === null || Math.abs(item.t - time) < Math.abs(best.t - time)) best = item;
		}
		if (best === null || Math.abs(best.t - time) > 120) return null;
		return best.level;
	}

	/** 用 0–1s 的候选延迟，选增益最稳定的 lag（MAD 最小）。 */
	private finishCalibration(now: number): void {
		this.calibrating = false;
		const mic = this.micHistory;
		if (mic.length < ECHO_CALIBRATION_MIN_SAMPLES) return;

		let best: { lagMs: number; gain: number; score: number } | null = null;
		for (let lagMs = 0; lagMs <= 1000; lagMs += 50) {
			const ratios: number[] = [];
			for (const sample of mic) {
				if (sample.level < ECHO_ABS_MIN) continue;
				const ref = this.refAt(sample.t - lagMs);
				if (ref === null || ref < ECHO_ABS_MIN) continue;
				const ratio = sample.level / ref;
				if (ratio >= 0.05 && ratio <= 3.5) ratios.push(ratio);
			}
			if (ratios.length < ECHO_CALIBRATION_MIN_SAMPLES) continue;
			const sorted = [...ratios].sort((a, b) => a - b);
			const gain = sorted[Math.floor(sorted.length / 2)];
			const mad = ratios.reduce((sum, value) => sum + Math.abs(value - gain), 0) / ratios.length;
			const score = mad / Math.max(gain, 0.01);
			if (best === null || score < best.score) best = { lagMs, gain, score };
		}
		if (best !== null && best.score < 0.45 && best.gain >= 0.05 && best.gain <= 3.5) {
			this.delayMs = best.lagMs;
			this.gain = best.gain;
		}
		this.micHistory = [];
		void now;
	}

	/** 患者是否正在出声（参考电平非零）。 */
	get playing(): boolean {
		return this.reference >= ECHO_ABS_MIN;
	}

	/** 当前帧是否像某个延迟点的参考回授。 */
	private matches(micLevel: number, reference: number): boolean {
		if (reference < ECHO_ABS_MIN) return false;
		const ratio = micLevel / reference;
		if (this.gain !== null) return ratio >= this.gain * 0.55 && ratio <= this.gain * 1.9;
		return ratio >= ECHO_RATIO_MIN && ratio < ECHO_RATIO_MAX;
	}

	/** 这一帧麦克风能量是否可能来自患者回放。 */
	isEcho(micLevel: number, now = performance.now()): boolean {
		// 用延迟后的参考判断“此刻麦克风里是否还有 TTS”，而不是当前输出；
		// 同时试 ±60ms，吸收 PCM 块缓冲和扬声器/房间造成的抖动。
		const baseDelay = this.gain !== null ? this.delayMs : ECHO_FALLBACK_DELAY_MS;
		for (const offset of [0, -60, 60]) {
			const reference = this.refAt(now - baseDelay - offset) ?? (offset === 0 ? this.reference : null);
			if (reference !== null && this.matches(micLevel, reference)) return true;
		}
		return false;
	}
}

export interface MicCaptureOptions extends MicCaptureConstraintsOptions {
	/** 已有麦克风流（VAD / 上一次会话）——复用它，不再开第二台。 */
	stream?: MediaStream | null;
	/** 已有 AudioContext（与 stream 配对时复用；VAD 必须与 PCM 在同一个图上）。 */
	audioContext?: AudioContext | null;
	/** 32 位浮点 PCM 的批回调（设备采样率），用于 RMS / 频谱类判定。 */
	onFrame?: (channel: Float32Array, sampleRate: number) => void;
	/** 患者 TTS 当前输出 RMS；持续写入回声门，用于丢弃回录 PCM。 */
	echoLevel?: () => number;
	pcm?: Pick<MicCaptureHandlers, "onPcm">;
}

/**
 * 采集会话：持有 stream / AudioContext / source / worklet。
 * `attach(context)` 用于把已有的 AudioContext 借给 VAD（同一条流、同一个图）。
 */
export class MicCapture {
	readonly stream: MediaStream;
	/** 患者 TTS 的参考电平（由音频出口侧持续写入，见 `setEchoLevel`）。 */
	readonly echo = new EchoGate();
	readonly context: AudioContext;
	private readonly source: MediaStreamAudioSourceNode;
	private worklet: AudioWorkletNode | null = null;
	private processor: ScriptProcessorNode | null = null;
	private muted = false;
	private closed = false;
	private latestMicLevel = 0;
	private echoLevel?: () => number;

	private constructor(stream: MediaStream, context: AudioContext, source: MediaStreamAudioSourceNode) {
		this.stream = stream;
		this.context = context;
		this.source = source;
	}

	static async open(options: MicCaptureOptions = {}): Promise<MicCapture> {
		let stream = options.stream ?? null;
		if (!stream) {
			if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
				throw new Error("mic_unavailable");
			}
			stream = await navigator.mediaDevices.getUserMedia(micConstraints(options));
		}
		const Ctor =
			typeof window !== "undefined"
				? ((window.AudioContext ??
						(window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext) as
						| typeof AudioContext
						| undefined)
				: undefined;
		if (!Ctor && !options.audioContext) {
			for (const track of stream.getTracks()) track.stop();
			throw new Error("audio_context_unavailable");
		}
		const context = options.audioContext ?? (Ctor ? new Ctor() : null);
		if (!context) {
			for (const track of stream.getTracks()) track.stop();
			throw new Error("audio_context_unavailable");
		}
		if (context.state === "suspended") await context.resume().catch(() => {});
		const source = context.createMediaStreamSource(stream);
		const capture = new MicCapture(stream, context, source);
		capture.start(options);
		return capture;
	}

	/** 设备采样率（重采样步长要它）。 */
	get sampleRate(): number {
		return this.context.sampleRate;
	}

	/**
	 * 接入两台消费者：
	 *   1. worklet（或 ScriptProcessor）转 16k PCM16 给云 ASR；
	 *   2. 一个 AnalyserNode 旁路，批出设备采样率帧供活跃度/回声判定。
	 * 麦克风**不**连 destination（会回声啸叫）：AnalyserNode 拉不拉得动图由 worklet 保证。
	 */
	private start(options: MicCaptureOptions): void {
		this.echoLevel = options.echoLevel;
		const basePcm = pcmSink(options.pcm?.onPcm);
		const pcm = basePcm
			? (data: unknown) => {
					if (this.isEchoPcm(data)) return;
					basePcm(data);
				}
			: null;
		void this.attachWorklet(pcm).catch(() => this.attachScriptProcessor(pcm));

		if (options.onFrame || options.echoLevel) {
			const analyser = this.context.createAnalyser();
			analyser.fftSize = 1024;
			this.source.connect(analyser);
			const buffer = new Float32Array(analyser.fftSize);
			let carry = 0;
			const pump = () => {
				if (this.closed) return;
				analyser.getFloatTimeDomainData(buffer);
				const level = rms(buffer);
				this.latestMicLevel = level;
				if (options.echoLevel) this.echo.setReference(options.echoLevel());
				this.echo.observe(level);
				carry += buffer.length / this.sampleRate;
				// 约 50ms 一批：够做 250ms 判定，又不会每 128 样本回调一次
				if (carry >= 0.05) {
					carry = 0;
					options.onFrame?.(buffer.slice(), this.sampleRate);
				}
				requestAnimationFrame(pump);
			};
			if (typeof requestAnimationFrame === "function") requestAnimationFrame(pump);
			else setInterval(pump, 50) as unknown as number;
		}
	}

	/** PCM 帧是否主要是患者回放：是则不送上游 ASR。 */
	private isEchoPcm(data: unknown): boolean {
		if (this.echoLevel) this.echo.setReference(this.echoLevel());
		const message = data as { type?: string; buffer?: ArrayBuffer } | null;
		if (message?.type !== "pcm" || !(message.buffer instanceof ArrayBuffer)) return false;
		const pcm = new Int16Array(message.buffer);
		if (pcm.length === 0) return false;
		let sum = 0;
		for (let i = 0; i < pcm.length; i += 1) sum += pcm[i] * pcm[i];
		const level = Math.sqrt(sum / pcm.length) / 32768;
		this.latestMicLevel = level;
		// 校准只用 analyser 的实时帧；PCM 块带缓冲延迟，塞进延迟估计会引入偏差。
		return this.echo.isEcho(level);
	}

	private async attachWorklet(pcm: ((data: unknown) => void) | null): Promise<void> {
		if (!this.context.audioWorklet) throw new Error("audioworklet_unavailable");
		const url = new URL("/pcm-capture-worklet.js", window.location.origin).href;
		await this.context.audioWorklet.addModule(url);
		if (this.closed) return;
		const node = new AudioWorkletNode(this.context, PCM_WORKLET_NAME, {
			numberOfInputs: 1,
			numberOfOutputs: 1,
			channelCount: 1,
			channelCountMode: "explicit",
			channelInterpretation: "speakers",
		});
		// 输出接一个 0 增益节点到 destination：Chrome 对没有下行消费者的 AudioWorkletNode 会节流
		const sink = this.context.createGain();
		sink.gain.value = 0;
		node.connect(sink);
		sink.connect(this.context.destination);
		this.source.connect(node);
		if (pcm) node.port.onmessage = (event) => pcm(event.data);
		node.port.postMessage({ type: "config", targetRate: TARGET_SAMPLE_RATE });
		this.worklet = node;
	}

	private attachScriptProcessor(pcm: ((data: unknown) => void) | null): void {
		if (this.closed) return;
		const processor = this.context.createScriptProcessor(SCRIPT_PROCESSOR_SIZE, 1, 1);
		const resampler = new Resampler(this.sampleRate);
		processor.onaudioprocess = (event) => {
			const channel = event.inputBuffer.getChannelData(0);
			if (pcm) {
				const out = new Int16Array(Math.ceil((channel.length * TARGET_SAMPLE_RATE) / this.sampleRate) + 2);
				const written = resampler.push(channel, out);
				pcm({ type: "pcm", buffer: out.slice(0, written).buffer });
			}
		};
		this.source.connect(processor);
		processor.connect(this.context.destination);
		this.processor = processor;
	}

	/** 复用同一个 AudioContext（VAD 的 `audioContext` 选项），不新建图。 */
	get audioContext(): AudioContext {
		return this.context;
	}

	/** 写入患者 TTS 的当前输出电平（0 = 没在播），打断判据据此排除回采。 */
	setEchoLevel(level: number): void {
		this.echo.setReference(level);
	}

	/** 这一帧麦克风能量是否主要来自患者回放（学生没开口）。 */
	isEcho(channel: Float32Array): boolean {
		return this.echo.isEcho(rms(channel));
	}

	/** 最近一帧是否仍是患者回放：供 VAD 事件门用。 */
	isCurrentEcho(): boolean {
		if (this.echoLevel) this.echo.setReference(this.echoLevel());
		return this.echo.isEcho(this.latestMicLevel);
	}

	/** 临时静音上游（VAD 误触发时挪开下巴即可撤回），不改动 track 状态。 */
	setMuted(muted: boolean): void {
		this.muted = muted;
		this.stream.getAudioTracks().forEach((track) => {
			track.enabled = !muted;
		});
	}

	get isMuted(): boolean {
		return this.muted;
	}

	/** 把整段录音降成 16k PCM16LE（按住模式一次性上传）。 */
	toPcm16(samples: Float32Array): ArrayBuffer {
		return downsampleToPcm16(samples, this.sampleRate);
	}

	/** 关闭：停轨道、断图、关 context（VAD 共用这条流时必须后关）。 */
	async close(): Promise<void> {
		if (this.closed) return;
		this.closed = true;
		try {
			this.worklet?.port.postMessage({ type: "reset" });
			this.worklet?.disconnect();
		} catch {
			/* 已断开 */
		}
		try {
			this.processor?.disconnect();
		} catch {
			/* 已断开 */
		}
		try {
			this.source.disconnect();
		} catch {
			/* 已断开 */
		}
		this.stream.getTracks().forEach((track) => {
			track.enabled = true;
			try {
				track.stop();
			} catch {
				/* 已停止 */
			}
		});
		await this.context.close().catch(() => {});
	}
}
