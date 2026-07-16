import type { TTSProvider } from "./types";

const EMOTION_RATE: Record<string, number> = {
	withdrawn: 0.85,
	defensive: 1.15,
	anxious: 1.1,
	neutral: 0.95,
	relaxed: 0.95,
	open: 1.0,
};

const EMOTION_PITCH: Record<string, number> = {
	withdrawn: 0.85,
	defensive: 1.15,
	anxious: 1.1,
	neutral: 1.0,
	relaxed: 0.95,
	open: 1.05,
};

function applyEmotion(
	utterance: { rate: number; pitch: number },
	emotion: string | undefined,
): void {
	const rate = EMOTION_RATE[emotion ?? ""] ?? 0.95;
	const pitch = EMOTION_PITCH[emotion ?? ""] ?? 1.0;
	utterance.rate = rate;
	utterance.pitch = pitch;
}

export function createBrowserTTS(): TTSProvider {
	let _speaking = false;
	let _emotion: string | undefined;

	return {
		get speaking() {
			return _speaking;
		},

		get providerName() {
			return "browser-speech-synthesis";
		},

		get emotion() {
			return _emotion;
		},

		set emotion(e: string | undefined) {
			_emotion = e;
		},

		speak(text: string): Promise<void> {
			return new Promise((resolve, reject) => {
				if (!window.speechSynthesis || typeof SpeechSynthesisUtterance === "undefined") {
					reject(new Error("浏览器不支持语音合成"));
					return;
				}

				try { speechSynthesis.cancel(); } catch { /* ignore */ }

				const utterance = new SpeechSynthesisUtterance(text);
				utterance.lang = "zh-CN";
				applyEmotion(utterance, _emotion);

				const voices = speechSynthesis.getVoices();
				const zhVoice = voices.find((v) => v.lang.startsWith("zh"));
				if (zhVoice) utterance.voice = zhVoice;

				utterance.onstart = () => {
					_speaking = true;
				};

				utterance.onend = () => {
					_speaking = false;
					resolve();
				};

				utterance.onerror = (e) => {
					_speaking = false;
					if (e.error === "canceled" || e.error === "interrupted") {
						resolve();
					} else {
						reject(new Error(`语音合成失败: ${e.error}`));
					}
				};

				speechSynthesis.speak(utterance);
			});
		},

		stop(): void {
			_speaking = false;
			try { speechSynthesis.cancel(); } catch { /* ignore */ }
		},
	};
}
