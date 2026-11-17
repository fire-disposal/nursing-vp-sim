import type { EchoCalibrationResult } from "@/engine/audio/mic";

/** 一次 ASR 会话的**中间**结果载荷：句子还没落定。 */
export interface AsrResult {
	/** 当前累计转写文本（含 interim）。 */
	transcript: string;
	/** 当前是否已稳定（末尾段已 final）。 */
	final: boolean;
}

/**
 * 一次识别会话上报给对答状态机的**全部**事件。
 *
 * 供应商只填自己有的字段：Web Speech 只有 `partial`/`definite`/`end`/`error`；
 * 云 ASR + VAD 额外有 `ready`（上游首帧就绪）、`speechStart` / `speechRealStart` /
 * `speechEnd`（VAD 轮次）与 `interim`（interim 驱动回退路径）。
 *
 * 语义分工（状态机据此决定"谁的回合、什么时候提交"）：
 *  - `speechStart`     —— 检测到有人开口：开始一轮学生回合（还**不能**打断患者）。
 *  - `speechRealStart` —— 确认是真语音（≥250ms）：此时才允许打断患者。
 *  - `speechEnd`       —— 一句说完：进入端点等待，等 `definite` 落地。
 *  - `partial`         —— 正在说的内容（字幕）。不允许提交。
 *  - `definite`        —— 一句的最终结果（可能为空串：没听清，不得提交）。
 *  - `interim`         —— 无 VAD 时的降级信号：有新的中间结果（据此起静音窗口）。
 */
export interface AsrEventHandlers {
	onReady?: () => void;
	onSpeechStart?: () => void;
	onSpeechRealStart?: () => void;
	onSpeechEnd?: () => void;
	onPartial?: (text: string) => void;
	onDefinite?: (text: string) => void;
	onInterim?: (text: string) => void;
	/** 会话自然结束（供应商侧关闭）。 */
	onEnd?: () => void;
	/** 供应商错误码/消息（原样透传，由消费者决定降级策略）。 */
	onError?: (error: string) => void;
	/** 采集/连接层性能状态：`degraded` = 已回退到基础语音模式。 */
	onPerformance?: (state: "calibrating" | "ok" | "degraded") => void;
}

/** 一次语音识别会话（由某供应商拉起）。 */
export interface AsrSession extends AsrEventHandlers {
	start(): void;
	/** 停止并释放（关 WS / 停 VAD；保留麦克风由调用方决定）。 */
	stop(): void;
	/** 麦克风与上游就绪后，由调用方显式开始回声校准采样。 */
	beginEchoCalibration?(): void;
	/**
	 * `true` = 该会话会自行上报 VAD 轮次事件（`speechStart`/`RealStart`/`End`）。
	 * 校准期/运行中降级会把它改成 `false`（同一会话就此退回 interim 驱动）。
	 */
	turnDetection?: boolean;
	/** `true` = 会话只上报整句结果（`definite`），不流式给 `partial`。 */
	readonly batch?: boolean;
}

/**
 * ASR 供应商抽象层 —— 语音对答的输入可替换点。
 *
 * `volcStreamAsrProvider`（同源 WebSocket + 豆包流式 ASR）是默认实现；
 * `webSpeechAsrProvider` 是零后端降级。消费方（`useVoiceDialogue`）只认本接口。
 */
export interface AsrProvider {
	/** 稳定标识，用于指标/日志。 */
	readonly id: string;
	/** 当前运行时是否支持该供应商。 */
	supported(): boolean;
	/** 拉起一次识别会话。 */
	createSession(options?: {
		lang?: string;
		interimResults?: boolean;
		continuous?: boolean;
		/** 训练记录 id（云 ASR 鉴权 + 资源归属）。 */
		recordId?: number;
		/** 会话令牌（云 ASR 的 WS 鉴权）。 */
		token?: string;
		/** 是否启用 VAD 轮次检测（持续模式 + 有麦克风采集时）。 */
		vad?: boolean;
		/** 采集链路已经拿到的流：VAD 复用它，不再另起一台麦克风。 */
		stream?: MediaStream | null;
		audioContext?: AudioContext;
		/** 患者 TTS 当前输出 RMS；用于回声门，避免回录被当成学生说话。 */
		echoLevel?: () => number;
		/** 接通音校准完成；电话页据此开放双工并显示校准徽章。 */
		onEchoCalibration?: (result: EchoCalibrationResult) => void;
		/** 16kHz TTS 参考波形，供发送前反相抵消。 */
		echoReference?: (startMs: number, length: number) => Float32Array;
		markerOnsets?: () => number[];
		/** 真实麦克风帧，供声学工作面板使用。 */
		onFrame?: (channel: Float32Array, sampleRate: number) => void;
	}): AsrSession;
}
