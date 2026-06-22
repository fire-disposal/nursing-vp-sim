import type { MessageBus } from "../types";
import type { EmotionState } from "../PluginContext";
import { createBrowserTTS } from "./browser-tts";
import type { TTSProvider, TTSManagerConfig } from "./types";
import { VolcTTSProvider } from "./VolcTTSProvider";

export class TTSManager {
	private emotionProvider: VolcTTSProvider;
	private fallbackProvider: TTSProvider;
	private bus: MessageBus | null = null;
	private autoPlay: boolean;
	private recordId: number | null;
	private prebufferAudio: ArrayBuffer | null = null;
	private currentEmotion: EmotionState = "neutral";
	private unsubs: Array<() => void> = [];

	constructor(config?: TTSManagerConfig) {
		this.emotionProvider = new VolcTTSProvider();
		this.fallbackProvider = createBrowserTTS();
		this.autoPlay = config?.autoPlay ?? true;
		this.recordId = config?.recordId ?? null;
	}

	get speaking(): boolean {
		return this.fallbackProvider.speaking;
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

		const unsubDone = bus.on("stream:done", () => {
			if (!this.autoPlay || this.fallbackProvider.speaking) return;
			void this.playPrebufferedOrFetch();
		});

		const unsubPrebuffer = bus.on("tts:prebuffer", (data: { text: string }) => {
			void this.prebuffer(data.text);
		});

		const unsubBeforeSend = bus.on("chat:beforeSend", () => {
			this.stop();
		});

		const unsubEmotion = bus.on(
			"emotion:changed",
			(data: { state: string }) => {
				this.currentEmotion = data.state as EmotionState;
				this.fallbackProvider.emotion = data.state;
			},
		);

		this.unsubs = [unsubDone, unsubPrebuffer, unsubBeforeSend, unsubEmotion];
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
			await this.tryEmotionSpeak(text);
			const latencyMs = Math.round(performance.now() - t0);
			this.bus?.emit("tts:end", text);
			this.bus?.emit("tts:provider-status", {
				provider: this.recordId
					? this.emotionProvider.providerName
					: this.fallbackProvider.providerName,
				latencyMs,
			});
		} catch (err) {
			const latencyMs = Math.round(performance.now() - t0);
			const message = err instanceof Error ? err.message : String(err);
			this.bus?.emit("tts:error", message);
			this.bus?.emit("tts:provider-status", {
				provider: this.recordId
					? this.emotionProvider.providerName
					: this.fallbackProvider.providerName,
				latencyMs,
			});
		}
	}

	async prebuffer(text: string): Promise<void> {
		if (!this.recordId) return;
		try {
			this.prebufferAudio = await this.emotionProvider.synthesize(
				text,
				this.recordId,
			);
		} catch {
			this.prebufferAudio = null;
		}
	}

	stop(): void {
		this.fallbackProvider.stop();
		this.emotionProvider.cancel();
		window.speechSynthesis?.cancel();
	}

	private async tryEmotionSpeak(text: string): Promise<void> {
		if (this.recordId) {
			const audio = await this.emotionProvider.synthesize(
				text,
				this.recordId,
			);
			await this.playAudio(audio);
			return;
		}
		this.fallbackProvider.emotion = this.currentEmotion;
		await this.fallbackProvider.speak(text);
	}

	private async playPrebufferedOrFetch(): Promise<void> {
		if (this.prebufferAudio) {
			const audio = this.prebufferAudio;
			this.prebufferAudio = null;
			try {
				await this.playAudio(audio);
				return;
			} catch {
				// fall through to DOM extraction fallback
			}
		}
		const text = this.extractLastPatientMessage();
		if (text) {
			await this.speak(text);
		}
	}

	private async playAudio(buffer: ArrayBuffer): Promise<void> {
		const blob = new Blob([buffer], { type: "audio/mpeg" });
		const url = URL.createObjectURL(blob);
		const audio = new Audio(url);
		try {
			await audio.play();
		} finally {
			URL.revokeObjectURL(url);
		}
	}

	private extractLastPatientMessage(): string {
		const elements = document.querySelectorAll(
			'[data-role="patient"]:not([data-initiated])',
		);
		const last = elements[elements.length - 1];
		const text = last?.textContent?.trim() ?? "";
		return text.replace(/\[.*?\]/g, "").trim();
	}
}
