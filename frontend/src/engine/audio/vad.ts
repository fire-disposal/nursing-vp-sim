/**
 * 语音活动检测（Silero VAD v5，`@ricky0123/vad-web` 的 `MicVAD`）。
 *
 * 三件事必须由这一层保证，不能散在 React 里：
 *  1. **同一条麦克风流**：`getStream` 返回采集链路已有的流，`pauseStream` 只暂停不 stop 轨道，
 *     `resumeStream` 还回同一条流。否则 VAD 自己有台麦克风、PCM 转发一台，AEC 双份回采。
 *  2. **性能校准**：初始化后先收一批 `onFrameProcessed` 间隔（跳过预热帧），跟不上实时就
 *     暂停 VAD、只留 PCM + 云 ASR，并把状态交给调用方提示"基础语音模式"。判定在
 *     `FrameTimingMonitor`（纯逻辑、可单测），这里只做接线。
 *  3. **事件语义**：start / real start / end / misfire 原样上报，校准期与非 listening 期的
 *     事件一律丢弃（否则冷启动的噪声会凭空开一轮学生回合）。
 *
 * ONNX 运行时与模型都在 `/vad/`（集成方复制静态资源）：模块顶层只是引用 `MicVAD` 类，
 * 权重与 worklet 在 `MicVAD.new()` 时才拉取，首屏不为它付网络代价。
 */
import { MicVAD } from "@ricky0123/vad-web";
import { FrameTimingMonitor, type PerformancePolicy, type PerformanceState } from "./perf";

export interface VadCallbacks {
	onSpeechStart?: () => void;
	/** 已确认是有效语音（≥ `minSpeechMs`）：只有它才算学生真的开口了。 */
	onSpeechRealStart?: () => void;
	onSpeechEnd?: () => void;
	onMisfire?: () => void;
	/** 性能状态变化（校准结论 / 运行中降级）。 */
	onPerformance?: (state: PerformanceState) => void;
}

export interface VadHandle {
	/** 停止 VAD（保留 MIC 流与 PCM 转发）；已暂停或未就绪时是空操作。 */
	pause(): Promise<void>;
	/** 恢复 VAD（流仍是同一条）。 */
	resume(): Promise<void>;
	/** 彻底销毁（停顿帧处理器、释放模型）。 */
	destroy(): Promise<void>;
	readonly state: PerformanceState;
}

/** VAD 静态资源目录约定：集成方把 vad-web 的 assets 复制到这里。 */
export const VAD_ASSET_PATH = "/vad/";
/** 资源里的文件名（vad-web 0.0.31 的 dist 产物）。 */
export const VAD_WORKLET = "vad.worklet.bundle.min.js";
export const VAD_MODEL = "silero_vad_v5.onnx";

/** 生产用本地 /vad；开发用同版本 CDN，避开 Vite 对 public 下 .mjs 动态导入的限制。 */
const ORT_RUNTIME_BASE = import.meta.env.DEV
	? "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.31.1/dist/"
	: VAD_ASSET_PATH;

/** 轮次判定的 VAD 参数：短噪声（<450ms）不算说话，900ms 静音才收尾。 */
export const VAD_TUNING = {
	// Silero/vad-web 默认 0.3 对空调噪声、键盘声都太敏感；电话页要的是"人声够持续"。
	positiveSpeechThreshold: 0.6,
	negativeSpeechThreshold: 0.35,
	minSpeechMs: 450,
	redemptionMs: 900,
	preSpeechPadMs: 500,
} as const;

/** `MicVAD` 的能力子集——只声明用到的部分，单测可用假实现注入。 */
export interface MicVadLike {
	listening: boolean;
	start: () => Promise<void>;
	pause: () => Promise<void>;
	destroy: () => Promise<void>;
}

export interface MicVadFactoryOptions {
	getStream: () => Promise<MediaStream>;
	pauseStream: (stream: MediaStream) => Promise<void>;
	resumeStream: (stream: MediaStream) => Promise<MediaStream>;
	audioContext: AudioContext;
	onSpeechStart: () => Promise<void> | void;
	onSpeechRealStart: () => Promise<void> | void;
	onSpeechEnd: (audio: Float32Array) => Promise<void> | void;
	onVADMisfire: () => Promise<void> | void;
	onFrameProcessed: () => Promise<void> | void;
}

export type MicVadFactory = (options: Partial<MicVadFactoryOptions> & Record<string, unknown>) => Promise<MicVadLike>;

/** 默认工厂：`MicVAD` 只在拉起会话时才会加载 ONNX 模型与 worklet。 */
export const loadMicVad: MicVadFactory = (options) => MicVAD.new(options);

export interface VadSessionOptions {
	/** 采集链路的流；`null` 表示让 VAD 自己开（未接 PCM 的降级路径）。 */
	stream?: MediaStream | null;
	audioContext?: AudioContext;
	callbacks?: VadCallbacks;
	policy?: Partial<PerformancePolicy>;
	/** 校准超时（ms）：到点没攒够帧也下结论。 */
	calibrationTimeoutMs?: number;
	/** 依赖注入：单测给假实现，绝不加载 ONNX。 */
	createVad?: MicVadFactory;
	now?: () => number;
}

/**
 * 拉起一次 VAD 会话。返回 `null` = 这套环境没有 VAD（无 worklet/模型加载失败），
 * 由调用方退回纯云 ASR 的 interim + 静音窗口路径。
 */
export async function startVadSession(
	options: VadSessionOptions = {},
): Promise<VadHandle | null> {
	const {
		stream = null,
		audioContext,
		callbacks = {},
		policy,
		calibrationTimeoutMs = 4000,
		createVad = loadMicVad,
		now = () => (typeof performance !== "undefined" ? performance.now() : Date.now()),
	} = options;

	const monitor = new FrameTimingMonitor(policy);
	let vad: MicVadLike | null = null;
	let disposed = false;
	let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

	const emitPerformance = () => {
		try {
			callbacks.onPerformance?.(monitor.current);
		} catch (err) {
			console.warn("[vad] 性能状态回调失败", err);
		}
	};

	/** 校准未落定或已降级/已销毁时，VAD 事件一律丢弃。 */
	const gate = (fn: (() => void) | undefined) => () => {
		if (disposed || !monitor.calibrated || monitor.current !== "ok") return;
		try {
			fn?.();
		} catch (err) {
			console.error("[vad] 事件处理失败", err);
		}
	};

	const clearCalibrationTimer = () => {
		clearTimeout(timeoutHandle);
		timeoutHandle = undefined;
	};

	/** 监测落定：跟不上实时就暂停 VAD，并把状态交出去。 */
	const settle = () => {
		clearCalibrationTimer();
		if (monitor.current === "degraded") {
			void vad?.pause().catch(() => {});
		}
		emitPerformance();
	};

	try {
		vad = await createVad({
			model: "v5",
			baseAssetPath: VAD_ASSET_PATH,
			onnxWASMBasePath: ORT_RUNTIME_BASE,
			...(audioContext ? { audioContext } : {}),
			getStream: async () => {
				if (stream) return stream;
				if (!navigator.mediaDevices?.getUserMedia) throw new Error("mic_unavailable");
				return navigator.mediaDevices.getUserMedia({
					audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
					video: false,
				});
			},
			// 暂停 VAD 不等于关麦克风：PCM 转发还在用这条流。
			pauseStream: async () => {},
			resumeStream: async () => {
				if (stream) return stream;
				return navigator.mediaDevices.getUserMedia({ audio: true });
			},
			...VAD_TUNING,
			onSpeechStart: gate(callbacks.onSpeechStart),
			onSpeechRealStart: gate(callbacks.onSpeechRealStart),
			onSpeechEnd: gate(callbacks.onSpeechEnd),
			onVADMisfire: gate(callbacks.onMisfire),
			onFrameProcessed: async () => {
				if (disposed) return;
				if (monitor.push(now())) settle();
			},
		});
	} catch (err) {
		console.warn("[vad] 初始化失败，退回纯云 ASR", err);
		clearCalibrationTimer();
		return null;
	}

	if (disposed) {
		await vad.destroy().catch(() => {});
		return null;
	}

	await vad.start().catch((err: unknown) => {
		console.warn("[vad] 启动失败", err);
	});

	// 慢设备可能一个帧都出不来：到点用已有样本（或直接判 ok）下结论，别把用户卡住。
	timeoutHandle = setTimeout(() => {
		if (disposed || monitor.calibrated) return;
		monitor.timeout();
		settle();
	}, calibrationTimeoutMs);

	return {
		get state() {
			return monitor.current;
		},
		async pause() {
			if (monitor.current === "degraded") return;
			await vad?.pause().catch(() => {});
		},
		async resume() {
			if (disposed || monitor.current !== "ok") return;
			await vad?.start().catch(() => {});
		},
		async destroy() {
			if (disposed) return;
			disposed = true;
			clearCalibrationTimer();
			await vad?.destroy().catch(() => {});
		},
	};
}
