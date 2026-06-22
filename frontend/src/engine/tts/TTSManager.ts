import type { MessageBus } from "../types";
import { createBrowserTTS } from "./browser-tts";
import type { TTSProvider } from "./types";

export class TTSManager {
	private provider: TTSProvider;
	private bus: MessageBus | null = null;
	private autoPlay: boolean;
	private unsubs: Array<() => void> = [];

	constructor(config?: { autoPlay?: boolean }) {
		this.provider = createBrowserTTS();
		this.autoPlay = config?.autoPlay ?? true;
	}

	get speaking(): boolean {
		return this.provider.speaking;
	}

	get isAutoPlay(): boolean {
		return this.autoPlay;
	}

	setAutoPlay(on: boolean): void {
		this.autoPlay = on;
	}

	/** 挂载到 MessageBus：监听 stream:done → 自动朗读 */
	attach(bus: MessageBus): void {
		this.bus = bus;

		const unsubDone = bus.on("stream:done", () => {
			if (!this.autoPlay || this.provider.speaking) return;
			const lastPatient = this.extractLastPatientMessage();
			if (lastPatient) {
				this.speak(lastPatient);
			}
		});

		// 当有插件发送消息前停止朗读
		const unsubBeforeSend = bus.on("chat:beforeSend", () => {
			this.stop();
		});

		this.unsubs = [unsubDone, unsubBeforeSend];
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
		try {
			await this.provider.speak(text);
			this.bus?.emit("tts:end", text);
		} catch (err: any) {
			this.bus?.emit("tts:error", err.message ?? String(err));
		}
	}

	stop(): void {
		this.provider.stop();
	}

	private extractLastPatientMessage(): string {
		const elements = document.querySelectorAll('[data-role="patient"]:not([data-initiated])');
		const last = elements[elements.length - 1];
		const text = last?.textContent?.trim() ?? "";
		// Strip non-verbal bracket cues like [叹气] [不安地挪动身体]
		return text.replace(/\[.*?\]/g, "").trim();
	}
}
