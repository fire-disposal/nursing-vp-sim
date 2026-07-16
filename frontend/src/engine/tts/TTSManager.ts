import { EMOTION_LABELS, type EmotionState } from "../PanelContext";
import type { MessageBus } from "../types";
import { createBrowserTTS } from "./browser-tts";
import type { TTSManagerConfig, TTSProvider } from "./types";
import { VolcTTSProvider } from "./VolcTTSProvider";

const MAX_TTS_LENGTH = 500;

function cleanTTSText(text: string): string {
	return text
		.replace(/\*\*(.+?)\*\*/g, "$1")
		.replace(/\*(.+?)\*/g, "$1")
		.replace(/\[.*?\]/g, "")
		.replace(/\n{2,}/g, "。")
		.replace(/\n/g, "")
		.trim();
}

function splitFirstSentence(text: string): [string, string] {
	const m = text.match(/^(.+?[。！？!?])/);
	if (!m || m[1].length >= text.length) return [text, ""];
	return [m[1], text.slice(m[1].length)];
}

export class TTSManager {
	private emotionProvider: VolcTTSProvider;
	private fallbackProvider: TTSProvider;
	private bus: MessageBus | null = null;
	private autoPlay: boolean;
	private recordId: number | null;
	private currentEmotion: EmotionState = "neutral";
	private unsubs: Array<() => void> = [];
	private _currentAudio: HTMLAudioElement | null = null;
	private _speaking = false;

	constructor(config?: TTSManagerConfig) {
		this.emotionProvider = new VolcTTSProvider();
		this.fallbackProvider = createBrowserTTS();
		this.autoPlay = config?.autoPlay ?? false;
		this.recordId = config?.recordId ?? null;
	}

	get speaking(): boolean {
		return this._speaking;
	}

	get isAutoPlay(): boolean {
		return this.autoPlay;
	}

	setAutoPlay(on: boolean): void {
		this.autoPlay = on;
	}

	setRecordId(id: number): void {
		this.recordId = id;
	}

	attach(bus: MessageBus): void {
		this.bus = bus;

		const unsubDone = bus.on("stream:done", (text?: string) => {
			if (!this.autoPlay || this._speaking) return;
			if (text) {
				this._pendingText = text;
			}
			void this.speakNext();
		});

		const unsubBeforeSend = bus.on("chat:beforeSend", () => {
			this.stop();
		});

		const unsubEmotion = bus.on(
			"emotion:changed",
			(data: { state: string }) => {
				this.currentEmotion = (data.state in EMOTION_LABELS ? data.state : "neutral") as EmotionState;
				this.fallbackProvider.emotion = data.state;
			},
		);

		this.unsubs = [unsubDone, unsubBeforeSend, unsubEmotion];
	}

	private _pendingText: string | null = null;

	private async speakNext(): Promise<void> {
		if (this._speaking) return;
		const raw = this._pendingText ?? "";
		this._pendingText = null;
		if (!raw) return;
		const text = cleanTTSText(raw).slice(0, MAX_TTS_LENGTH);
		if (!text) return;
		this._speaking = true;
		try {
			if (text.length > 50) {
				const [first, rest] = splitFirstSentence(text);
				await this.speak(first);
				if (rest) {
					await this.speak(rest);
				}
			} else {
				await this.speak(text);
			}
		} finally {
			this._speaking = false;
		}
	}

	detach(): void {
		for (const fn of this.unsubs) fn();
		this.unsubs = [];
		this.stop();
		this.bus = null;
	}

	async speak(text: string): Promise<void> {
		if (!text.trim()) return;
		this.bus?.emit("tts:start", text);
		const t0 = performance.now();
		try {
			const provider = await this.tryEmotionSpeak(text);
			const latencyMs = Math.round(performance.now() - t0);
			this.bus?.emit("tts:end", text);
			this.bus?.emit("tts:provider-status", { provider, latencyMs });
		} catch (err) {
			const latencyMs = Math.round(performance.now() - t0);
			const message = err instanceof Error ? err.message : String(err);
			this.bus?.emit("tts:error", message);
			this.bus?.emit("tts:provider-status", {
				provider: "unavailable",
				latencyMs,
			});
		}
	}

	stop(): void {
		this._pendingText = null;
		this.fallbackProvider.stop();
		this.emotionProvider.cancel();
		this._currentAudio?.pause();
		this._currentAudio = null;
		try { window.speechSynthesis?.cancel(); } catch { /* ignore */ }
	}

	/** Speak `text`, returning the provider name that actually produced audio. */
	private async tryEmotionSpeak(text: string): Promise<string> {
		if (this.recordId) {
			try {
				const audio = await this.emotionProvider.synthesize(
					text,
					this.recordId,
				);
				await this.playAudio(audio);
				return this.emotionProvider.providerName;
			} catch {
				// fall through to browser TTS fallback
			}
		}
		this.bus?.emit("tts:degraded", { provider: this.fallbackProvider.providerName });
		this.fallbackProvider.emotion = this.currentEmotion;
		await this.fallbackProvider.speak(text);
		return this.fallbackProvider.providerName;
	}

	private async playAudio(buffer: ArrayBuffer): Promise<void> {
		const blob = new Blob([buffer], { type: "audio/mpeg" });
		const url = URL.createObjectURL(blob);
		const audio = new Audio(url);
		this._currentAudio = audio;
		audio.addEventListener("ended", () => URL.revokeObjectURL(url), { once: true });
		audio.addEventListener("error", () => URL.revokeObjectURL(url), { once: true });
		try {
			await audio.play();
		} finally {
			if (this._currentAudio === audio) this._currentAudio = null;
		}
	}
}
