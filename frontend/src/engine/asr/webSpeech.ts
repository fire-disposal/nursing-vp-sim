import type { AsrProvider, AsrSession } from "./types";

function detectSpeechRecognition(): (typeof SpeechRecognition) | null {
	return window.SpeechRecognition ?? window.webkitSpeechRecognition ?? null;
}

/**
 * 浏览器 Web Speech API 实现（Chrome/Edge 内建，免费、零后端）。
 *
 * 降级路径：云 ASR 未配置（4401）、初始化失败、或环境没有 WebSocket 时用它。
 * 它是 `interimResults` 半句 + `onend` 说停即收尾的语义，与 `useVoiceDialogue` 的
 * 自动发送契约一致；没有 VAD，因此 `turnDetection` 为 false（打断判据退回 interim 文本）。
 */
export const webSpeechAsrProvider: AsrProvider = {
	id: "web-speech",
	supported() {
		return detectSpeechRecognition() !== null;
	},
	createSession(options = {}) {
		const Ctor = detectSpeechRecognition();
		if (!Ctor) throw new Error("Web Speech ASR 不可用");

		const rec = new Ctor();
		rec.lang = options.lang ?? "zh-CN";
		rec.interimResults = options.interimResults ?? true;
		rec.continuous = options.continuous ?? false;

		const session: AsrSession = {
			turnDetection: false,
			start: () => rec.start(),
			stop: () => rec.stop(),
		};

		// 归一化浏览器事件 → 供应商中立的事件。Web Speech 没有 VAD：
		// 非 final 的累计文本同时是 `partial`（字幕）与 `interim`（打断/静音窗口信号）。
		rec.onresult = (e) => {
			let acc = "";
			let allFinal = true;
			for (let i = 0; i < e.results.length; i += 1) {
				acc += e.results[i][0].transcript;
				if (!e.results[i].isFinal) allFinal = false;
			}
			if (allFinal) session.onDefinite?.(acc);
			else {
				session.onPartial?.(acc);
				session.onInterim?.(acc);
			}
		};
		rec.onend = () => session.onEnd?.();
		// 错误码必须原样透传：持续聆听要根据 not-allowed / audio-capture（降级按住说话）
		// 与 no-speech / aborted（连续聆听的正常噪声）做不同处置。
		rec.onerror = (e) => session.onError?.((e as SpeechRecognitionErrorEvent)?.error || "recognition_failed");

		return session;
	},
};
