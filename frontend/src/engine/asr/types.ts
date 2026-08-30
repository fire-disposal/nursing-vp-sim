/** 一次 ASR 会话的结果载荷。 */
export interface AsrResult {
	/** 当前累计转写文本（含 interim）。 */
	transcript: string;
	/** 当前是否已稳定（末尾段已 final）。 */
	final: boolean;
}

/** 一次语音识别会话（由某供应商拉起）。 */
export interface AsrSession {
	start(): void;
	stop(): void;
	onresult: ((result: AsrResult) => void) | null;
	onend: (() => void) | null;
	onerror: ((error: string) => void) | null;
}

/**
 * ASR 供应商抽象层 —— 语音对答的输入可替换点。
 *
 * 现在只有 `webSpeechAsrProvider`（浏览器 Web Speech API，免费、零后端）。
 * 未来接入在线 ASR（如 Volc BigASR / OpenAI）时，只需实现本接口并在
 * `index.ts` 的 `defaultAsrProvider` 切换，消费方（`useVoiceDialogue` 等）
 * 零改动。`id` 用于指标/日志区分供应商。
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
	}): AsrSession;
}
