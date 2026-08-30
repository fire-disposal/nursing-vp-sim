import type { AsrProvider, AsrSession } from "./types";

function detectSpeechRecognition(): (typeof SpeechRecognition) | null {
	return window.SpeechRecognition ?? window.webkitSpeechRecognition ?? null;
}

/**
 * 浏览器 Web Speech API 实现（Chrome/Edge 内建，免费、零后端）。
 *
 * 当前唯一的 ASR 实现。未来在线 ASR（如 Volc BigASR）实现同一
 * `AsrProvider` 接口后在 `index.ts` 切换即可，消费方零改动。
 * 它是 `interimResults` 半句 + `onend` 说停即收尾的语义，与
 * `useVoiceDialogue` 的自动发送契约一致。
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
			start: () => rec.start(),
			stop: () => rec.stop(),
			onresult: null,
			onend: null,
			onerror: null,
		};

		// 归一化浏览器事件 → 供应商中立的事件。
		rec.onresult = (e) => {
			let acc = "";
			let allFinal = true;
			for (let i = 0; i < e.results.length; i += 1) {
				acc += e.results[i][0].transcript;
				if (!e.results[i].isFinal) allFinal = false;
			}
			session.onresult?.({ transcript: acc, final: allFinal });
		};
		rec.onend = () => session.onend?.();
		rec.onerror = () => session.onerror?.("recognition_failed");

		return session;
	},
};
