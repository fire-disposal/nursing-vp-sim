import { downsampleToPcm16, Resampler, TARGET_SAMPLE_RATE } from "./resample";
import { getAec3, processAec3 } from "./aec3";

export const PCM_WORKLET_NAME = "pcm-capture";
/** worklet 设备初始化失败的兜底：直接用 ScriptProcessor 重采样（旧内核/被策略禁用）。 */
const SCRIPT_PROCESSOR_SIZE = 4096;

export interface MicCaptureConstraintsOptions {
	deviceId?: string;
	/** 由 AEC3 接管回声消除时，关闭浏览器自带 AEC/NS/AGC。 */
	aec3?: boolean;
}

/** 采集约束：单声道 + 浏览器基础 DSP；云 ASR 只吃 16k 单声道。 */
export function micConstraints(options: MicCaptureConstraintsOptions = {}): MediaStreamConstraints {
	const audio: MediaTrackConstraints = {
		channelCount: 1,
		echoCancellation: !options.aec3,
		noiseSuppression: !options.aec3,
		autoGainControl: !options.aec3,
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

export interface MicCaptureOptions extends MicCaptureConstraintsOptions {
	/** 已有麦克风流（VAD / 上一次会话）——复用它，不再开第二台。 */
	stream?: MediaStream | null;
	/** 已有 AudioContext（与 stream 配对时复用；VAD 必须与 PCM 在同一个图上）。 */
	audioContext?: AudioContext | null;
	/** 实际播放参考 PCM，AEC3 用它抵消扬声器回授。 */
	echoReference?: (startMs: number, length: number) => Float32Array;
	/** AEC3 处理后的实际 ASR 帧。 */
	onPcmFrame?: (frame: { mic: Int16Array; clean: Int16Array; endMs: number }) => void;
	/** AEC3 的延迟/ERLE 统计。 */
	onAec3Stats?: (stats: import("./aec3").CancellerStats) => void;
	pcm?: Pick<MicCaptureHandlers, "onPcm">;
}

/** 麦克风采集：一条流、一个 AudioContext；ASR 音频经 AEC3 处理后发送。 */
export class MicCapture {
	readonly stream: MediaStream;
	readonly context: AudioContext;
	private readonly source: MediaStreamAudioSourceNode;
	private worklet: AudioWorkletNode | null = null;
	private processor: ScriptProcessorNode | null = null;
	private muted = false;
	private closed = false;
	private echoReference?: (startMs: number, length: number) => Float32Array;
	private onPcmFrame?: MicCaptureOptions["onPcmFrame"];
	private onAec3Stats?: MicCaptureOptions["onAec3Stats"];

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

	get sampleRate(): number {
		return this.context.sampleRate;
	}

	private start(options: MicCaptureOptions): void {
		this.echoReference = options.echoReference;
		this.onPcmFrame = options.onPcmFrame;
		this.onAec3Stats = options.onAec3Stats;
		const basePcm = pcmSink(options.pcm?.onPcm);
		const pcm = basePcm
			? (data: unknown) => {
					const cleaned = this.cleanPcm(data);
					if (cleaned) basePcm(cleaned);
				}
			: null;
		void this.attachWorklet(pcm).catch(() => this.attachScriptProcessor(pcm));


	}

	/** 只做 AEC3 处理；AEC3 未就绪时原样上行，不做任何手写回声门。 */
	private cleanPcm(data: unknown): unknown | null {
		const message = data as { type?: string; buffer?: ArrayBuffer } | null;
		if (message?.type !== "pcm" || !(message.buffer instanceof ArrayBuffer)) return null;
		const pcm = new Int16Array(message.buffer);
		if (pcm.length === 0) return null;
		const endMs = performance.now();
		const canceller = getAec3();
		if (canceller && this.echoReference) {
			// AEC3 要的是当前渲染参考；麦克风帧本身已比播放滞后。
			const reference = this.echoReference(performance.now(), pcm.length);
			const result = processAec3(pcm, reference);
			if (result) {
				this.onAec3Stats?.(result.stats);
				this.onPcmFrame?.({ mic: pcm, clean: result.clean, endMs });
				return { type: "pcm", buffer: result.clean.buffer };
			}
		}
		this.onPcmFrame?.({ mic: pcm, clean: pcm, endMs });
		return message;
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

	get audioContext(): AudioContext {
		return this.context;
	}

	get isMuted(): boolean {
		return this.muted;
	}

	setMuted(muted: boolean): void {
		this.muted = muted;
		this.stream.getAudioTracks().forEach((track) => {
			track.enabled = !muted;
		});
	}

	toPcm16(samples: Float32Array): ArrayBuffer {
		return downsampleToPcm16(samples, this.sampleRate);
	}

	async close(): Promise<void> {
		if (this.closed) return;
		this.closed = true;
		try {
			this.worklet?.port.postMessage({ type: "reset" });
			this.worklet?.disconnect();
		} catch {
			/* already disconnected */
		}
		try {
			this.processor?.disconnect();
		} catch {
			/* already disconnected */
		}
		try {
			this.source.disconnect();
		} catch {
			/* already disconnected */
		}
		this.stream.getTracks().forEach((track) => {
			track.enabled = true;
			try {
				track.stop();
			} catch {
				/* already stopped */
			}
		});
		await this.context.close().catch(() => {});
	}
}
