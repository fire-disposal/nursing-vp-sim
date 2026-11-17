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
import { getAec3, processAec3, type CancellerStats } from "./aec3";

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
const ECHO_CALIBRATION_MS = 1600;
const ECHO_CALIBRATION_MIN_SAMPLES = 12;
const ECHO_ONSET_MIN_MS = 25;
const ECHO_INTERVAL_TOLERANCE_MS = 100;
/** 校准完成前也按常见声学延迟取参考，避免拿“当前帧”对“已到麦克风的旧回声”。 */
const ECHO_FALLBACK_DELAY_MS = 120;

export interface EchoCalibrationResult {
	status: "success" | "failed";
	delayMs: number;
	gain: number | null;
	/** 起音间隔误差换算的匹配度。 */
	score: number | null;
	reason?: "no_samples" | "no_reference" | "no_mic_onsets" | "interval_mismatch" | "low_gain";
	refOnsets?: number[];
	micOnsets?: number[];
	errorMs?: number | null;
	noiseFloor?: number;
}

export interface EchoSuppressionResult {
	micLevel: number;
	cleanLevel: number;
	reductionDb: number;
	gain: number;
	delayMs: number;
	polarity: 1 | -1;
}

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
	/** 校准完成回调；成功与失败都必须上报，调用方不能盲等。 */
	onResult?: (result: EchoCalibrationResult) => void;
	markerOnsets?: () => number[];
	private reference = 0;
	private gain: number | null = null;
	private noiseFloor = 0;
	private delayMs = 0;
	private calibrating = false;
	private calibrationUntil = 0;
	/** 50ms 帧的参考/麦克风时间序列；用于估延迟与延迟对齐后的增益。 */
	private refHistory: Array<{ t: number; level: number }> = [];
	private micHistory: Array<{ t: number; level: number }> = [];

	/** 在首次 TTS 播放、环境安静时调用；1.5 秒内估计延迟与中位回授增益。 */
	beginCalibration(now = performance.now()): void {
		this.refHistory = [];
		this.micHistory = [];
		this.calibrating = true;
		this.calibrationUntil = now + ECHO_CALIBRATION_MS;
	}

	get calibrated(): boolean {
		return this.gain !== null;
	}

	get gainValue(): number | null {
		return this.gain;
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

	/** 每 50ms 的麦克风帧：只在校准期记录，结束后不再保留重复历史。 */
	observe(micLevel: number, now = performance.now()): void {
		if (!this.calibrating) return;
		this.micHistory.push({ t: now, level: micLevel });
		if (now >= this.calibrationUntil || this.micHistory.length >= 60) this.finishCalibration();
	}

	/** 取参考序列中离指定时间最近的帧；超出 50ms 视为缺失。 */
	private refAt(time: number): number | null {
		let best: { t: number; level: number } | null = null;
		for (const item of this.refHistory) {
			if (best === null || Math.abs(item.t - time) < Math.abs(best.t - time)) best = item;
		}
		if (best === null || Math.abs(best.t - time) > 50) return null;
		return best.level;
	}

	/** 检测能量超过阈值的连续段，返回每段起音时间。 */
	private detectOnsets(history: Array<{ t: number; level: number }>, threshold: number): number[] {
		const onsets: number[] = [];
		let active = false;
		let start = 0;
		for (const item of history) {
			if (item.level >= threshold && !active) {
				active = true;
				start = item.t;
			} else if (item.level < threshold && active) {
				if (item.t - start >= ECHO_ONSET_MIN_MS) onsets.push(start);
				active = false;
			}
		}
		if (active && history.length > 0 && history[history.length - 1].t - start >= ECHO_ONSET_MIN_MS) onsets.push(start);
		return onsets;
	}

	/** 用三次“滴滴”的精确起音间隔对齐；间隔与首音偏移同时成立才算匹配。 */
	private finishCalibration(): void {
		this.calibrating = false;
		const mic = this.micHistory;
		if (mic.length < ECHO_CALIBRATION_MIN_SAMPLES) {
			this.micHistory = [];
			this.onResult?.({ status: "failed", delayMs: this.delayMs, gain: null, score: null, reason: "no_samples" });
			return;
		}

		const firstToneAt = this.refHistory.find((item) => item.level >= ECHO_ABS_MIN)?.t ?? Number.POSITIVE_INFINITY;
		const ambient = mic.filter((sample) => sample.t < firstToneAt).map((sample) => sample.level).sort((a, b) => a - b);
		this.noiseFloor = ambient.length ? ambient[Math.floor(ambient.length / 2)] : 0;

		const refPeak = Math.max(0, ...this.refHistory.map((item) => item.level));
		const micPeak = Math.max(0, ...mic.map((sample) => Math.max(0, sample.level - this.noiseFloor)));
		const refThreshold = refPeak * 0.2;
		const micThreshold = this.noiseFloor + Math.max(this.noiseFloor * 1.25, micPeak * 0.08, ECHO_ABS_MIN * 1.5);
		const detectedRefOnsets = this.detectOnsets(this.refHistory, refThreshold).slice(0, 3);
		const knownRefOnsets = this.markerOnsets?.() ?? [];
		const refOnsets = knownRefOnsets.length === 3 ? knownRefOnsets : detectedRefOnsets;
		const micOnsets = this.detectOnsets(mic, micThreshold);

		let best: { delayMs: number; error: number; onsets: number[]; refIndices: number[] } | null = null;
		if (refOnsets.length === 3) {
			const refGap1 = refOnsets[1] - refOnsets[0];
			const refGap2 = refOnsets[2] - refOnsets[1];
			for (let i = 0; i < micOnsets.length - 2; i += 1) {
				for (let j = i + 1; j < micOnsets.length - 1; j += 1) {
					for (let k = j + 1; k < micOnsets.length; k += 1) {
						const gapError = Math.max(
							Math.abs(micOnsets[j] - micOnsets[i] - refGap1),
							Math.abs(micOnsets[k] - micOnsets[j] - refGap2),
						);
						const delayMs = micOnsets[i] - refOnsets[0];
						if (delayMs < 0 || delayMs > 1000) continue;
						if (best === null || gapError < best.error) {
							best = { delayMs, error: gapError, onsets: [micOnsets[i], micOnsets[j], micOnsets[k]], refIndices: [0, 1, 2] };
						}
					}
				}
			}
		}

		// 少一枚起音时，用两次滴声的已知间隔做后备；时间差成立即可。
		if (refOnsets.length === 3 && micOnsets.length >= 2) {
			for (const [a, b] of [[0, 1], [1, 2], [0, 2]] as const) {
				const expected = refOnsets[b] - refOnsets[a];
				for (let i = 0; i < micOnsets.length - 1; i += 1) {
					for (let j = i + 1; j < micOnsets.length; j += 1) {
						const gapError = Math.abs(micOnsets[j] - micOnsets[i] - expected);
						const delayMs = micOnsets[i] - refOnsets[a];
						if (delayMs < 0 || delayMs > 1000) continue;
						if (best === null || gapError < best.error) {
							best = { delayMs, error: gapError, onsets: [micOnsets[i], micOnsets[j]], refIndices: [a, b] };
						}
					}
				}
			}
		}

		let gain: number | null = null;
		if (best !== null && best.error <= ECHO_INTERVAL_TOLERANCE_MS) {
			const ratios: number[] = [];
			for (let q = 0; q < best.onsets.length; q += 1) {
				const micOnset = best.onsets[q];
				const refOnset = refOnsets[best.refIndices[q]];
				const micPeak = Math.max(
					0,
					...mic
						.filter((sample) => sample.t >= micOnset && sample.t <= micOnset + 140)
						.map((sample) => Math.max(0, sample.level - this.noiseFloor)),
				);
				const refPeak = Math.max(
					0,
					...this.refHistory
						.filter((item) => item.t >= refOnset && item.t <= refOnset + 140)
						.map((item) => item.level),
				);
				if (micPeak >= ECHO_ABS_MIN && refPeak >= ECHO_ABS_MIN) {
					const ratio = micPeak / refPeak;
					if (ratio > 0 && Number.isFinite(ratio)) ratios.push(ratio);
				}
			}
			if (ratios.length > 0) {
				const sorted = [...ratios].sort((a, b) => a - b);
				gain = sorted[Math.floor(sorted.length / 2)];
			}
		}

		const score = best === null ? null : Math.max(0, 1 - best.error / 100);
		if (best !== null && best.error <= ECHO_INTERVAL_TOLERANCE_MS) {
			this.delayMs = best.delayMs;
			// 时间差已经成立，增益只做限幅/兜底，不参与成败判定。
			this.gain = gain === null ? 0.5 : Math.min(3.5, Math.max(0.05, gain));
		}
		const reason =
			this.gain !== null
				? undefined
				: refOnsets.length !== 3
					? "no_reference"
					: micOnsets.length < 3
						? "no_mic_onsets"
						: best === null
							? "no_mic_onsets"
							: "interval_mismatch";
		if (import.meta.env.DEV) {
			console.info("[echo] calibration", {
				delayMs: this.delayMs,
				gain: this.gain,
				match: score,
				errorMs: best?.error ?? null,
				refOnsets,
				micOnsets,
				noiseFloor: this.noiseFloor,
			});
		}
		this.onResult?.({
			status: this.gain === null ? "failed" : "success",
			delayMs: this.delayMs,
			gain: this.gain,
			score,
			reason,
			refOnsets,
			micOnsets,
			errorMs: best?.error ?? null,
			noiseFloor: this.noiseFloor,
		});
		this.micHistory = [];
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
	/** 接通音校准完成：只有 success 才允许进入双工。 */
	onEchoCalibration?: (result: EchoCalibrationResult) => void;
	/** 16kHz 参考波形，起始时间为 performance.now() 时间轴。 */
	echoReference?: (startMs: number, length: number) => Float32Array;
	/** 播放器实际调度出的三次起音时间，避免参考波形缺失时无法匹配。 */
	markerOnsets?: () => number[];
	/** ASR 发送前的实际残留能量，用于判断反相抵消是否生效。 */
	onEchoSuppression?: (result: EchoSuppressionResult) => void;
	/** AEC3 的延迟与 ERLE 统计。 */
	onAec3Stats?: (stats: CancellerStats) => void;
	/** 真正送往 ASR 的 16k PCM，用于工作台展示反相器输出。 */
	onCleanedPcm?: (samples: Int16Array) => void;
	/** 同一时间戳下的原始/反相 PCM 帧，供波形对齐。 */
	onPcmFrame?: (frame: { mic: Int16Array; clean: Int16Array; endMs: number }) => void;
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
	private echoReference?: (startMs: number, length: number) => Float32Array;
	private onEchoSuppression?: (result: EchoSuppressionResult) => void;
	private onAec3Stats?: (stats: CancellerStats) => void;
	private onCleanedPcm?: (samples: Int16Array) => void;
	private onPcmFrame?: (frame: { mic: Int16Array; clean: Int16Array; endMs: number }) => void;

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
		this.echo.onResult = options.onEchoCalibration;
		this.echo.markerOnsets = options.markerOnsets;
		this.echoLevel = options.echoLevel;
		this.echoReference = options.echoReference;
		this.onEchoSuppression = options.onEchoSuppression;
		this.onAec3Stats = options.onAec3Stats;
		this.onCleanedPcm = options.onCleanedPcm;
		this.onPcmFrame = options.onPcmFrame;
		const basePcm = pcmSink(options.pcm?.onPcm);
		const pcm = basePcm
			? (data: unknown) => {
					const cleaned = this.cleanPcm(data);
					if (cleaned) basePcm(cleaned);
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

	/** 先丢明显回录，再按校准偏移/增益做 mic - gain × delayedReference。 */
	private cleanPcm(data: unknown): unknown | null {
		if (this.echoLevel) this.echo.setReference(this.echoLevel());
		const message = data as { type?: string; payload?: ArrayBuffer; buffer?: ArrayBuffer } | null;
		const rawBuffer = message?.buffer instanceof ArrayBuffer ? message.buffer : message?.payload;
		if (message?.type !== "pcm" || !(rawBuffer instanceof ArrayBuffer)) return null;
		const pcm = new Int16Array(rawBuffer);
		if (pcm.length === 0) return null;
		const endMs = performance.now();
		let micEnergy = 0;
		for (let i = 0; i < pcm.length; i += 1) micEnergy += (pcm[i] ?? 0) * (pcm[i] ?? 0);
		const level = Math.sqrt(micEnergy / pcm.length) / 32768;
		this.latestMicLevel = level;

		const aec3 = getAec3();
		if (aec3 && this.echoReference) {
			const referenceStart = endMs - pcm.length / 16;
			const reference = this.echoReference(referenceStart, pcm.length);
			const result = processAec3(pcm, reference);
			if (result) {
				this.onAec3Stats?.(result.stats);
				this.onPcmFrame?.({ mic: pcm, clean: result.clean, endMs });
				return { type: "pcm", buffer: result.clean.buffer };
			}
		}

		const gain = this.echo.gainValue;
		if (gain === null || !this.echoReference) {
			this.onCleanedPcm?.(pcm);
			this.onPcmFrame?.({ mic: pcm, clean: pcm, endMs });
			return this.echo.isEcho(level) ? null : data;
		}

		const baseStart = endMs - pcm.length / 16 - this.echo.delay;
		const scales = [0.75, 1, 1.25] as const;
		let best: { delta: number; scale: number; polarity: 1 | -1; energy: number } | null = null;
		for (let delta = -40; delta <= 40; delta += 8) {
			const reference = this.echoReference(baseStart - delta, pcm.length);
			let referenceEnergy = 0;
			for (let i = 0; i < reference.length; i += 1) referenceEnergy += (reference[i] ?? 0) ** 2;
			if (referenceEnergy < 1e-9) continue;
			for (const scale of scales) {
				const effective = Math.min(3.5, gain * scale);
				let minusEnergy = 0;
				let plusEnergy = 0;
				for (let i = 0; i < pcm.length; i += 1) {
					const scaled = Math.round((reference[i] ?? 0) * effective * 32768);
					const original = pcm[i] ?? 0;
					const sub = Math.max(-32768, Math.min(32767, original - scaled));
					const add = Math.max(-32768, Math.min(32767, original + scaled));
					minusEnergy += sub * sub;
					plusEnergy += add * add;
				}
				const energy = Math.min(minusEnergy, plusEnergy);
				const polarity = minusEnergy <= plusEnergy ? 1 : -1;
				if (best === null || energy < best.energy) best = { delta, scale, polarity, energy };
			}
		}

		if (best === null || best.energy >= micEnergy * 0.98) {
			this.onCleanedPcm?.(pcm);
			this.onPcmFrame?.({ mic: pcm, clean: pcm, endMs });
			return this.echo.isEcho(level) ? null : data;
		}

		const reference = this.echoReference(baseStart - best.delta, pcm.length);
		const effectiveGain = Math.min(3.5, gain * best.scale) * best.polarity;
		const cleaned = new Int16Array(pcm.length);
		for (let i = 0; i < pcm.length; i += 1) {
			const scaled = Math.round((reference[i] ?? 0) * effectiveGain * 32768);
			const original = pcm[i] ?? 0;
			cleaned[i] = Math.max(-32768, Math.min(32767, original - scaled));
		}
		const cleanLevel = Math.sqrt(best.energy / pcm.length) / 32768;
		this.onCleanedPcm?.(cleaned);
		this.onPcmFrame?.({ mic: pcm, clean: cleaned, endMs });
		this.onEchoSuppression?.({
			micLevel: level,
			cleanLevel,
			reductionDb: 20 * Math.log10(Math.max(level, 1e-6) / Math.max(cleanLevel, 1e-6)),
			gain: Math.abs(effectiveGain),
			delayMs: this.echo.delay + best.delta,
			polarity: best.polarity,
		});
		if (this.echo.isEcho(cleanLevel)) return null;
		return { type: "pcm", buffer: cleaned.buffer };
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

	/** 麦克风与 ASR 已就绪后、播放校准音前调用。 */
	beginEchoCalibration(): void {
		this.echo.beginCalibration();
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
