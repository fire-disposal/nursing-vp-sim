import { EMOTION_LABELS, type EmotionState } from "../PanelContext";
import type { MessageBus } from "../types";
import { createBrowserTTS } from "./browser-tts";
import { PcmStreamPlayer } from "./pcm-player";
import { cleanTTSText, MAX_TTS_LENGTH, SentenceSegmenter } from "./segmenter";
import type { TTSManagerConfig, TTSProvider } from "./types";
import { TTSCircuitOpenError, VolcTTSProvider } from "./VolcTTSProvider";

/**
 * TTSManager — sentence-pipelined streaming playback.
 *
 * Listens to LLM stream chunks, dispatches each sentence for synthesis the
 * moment its boundary arrives, and schedules PCM audio on Web Audio as chunks
 * stream in. Synthesis of sentence N+1 overlaps playback of sentence N.
 * Degrades to browser speech synthesis per-sentence on failure, and for the
 * whole reply when the backend circuit breaker is open.
 */
export class TTSManager {
	private emotionProvider = new VolcTTSProvider();
	private fallbackProvider: TTSProvider = createBrowserTTS();
	private player = new PcmStreamPlayer();
	private segmenter = new SentenceSegmenter(MAX_TTS_LENGTH);
	private bus: MessageBus | null = null;
	private autoPlay: boolean;
	private recordId: number | null;
	private currentEmotion: EmotionState = "neutral";
	private unsubs: Array<() => void> = [];

	private queue: string[] = [];
	private processing = false;
	private streamDone = false;
	private replyDegraded = false;
	private abortCtl: AbortController | null = null;
	private replyStart = 0;
	private firstChunkMs: number | null = null;
	private started = false;
	private lastProvider = "volcengine-tts";

	constructor(config?: TTSManagerConfig) {
		this.autoPlay = config?.autoPlay ?? false;
		this.recordId = config?.recordId ?? null;
	}

	get speaking(): boolean {
		return this.processing || this.player.playing;
	}

	get isAutoPlay(): boolean {
		return this.autoPlay;
	}

	setAutoPlay(on: boolean): void {
		this.autoPlay = on;
		if (on) this.player.prime();
	}

	setRecordId(id: number): void {
		this.recordId = id;
	}

	attach(bus: MessageBus): void {
		this.bus = bus;

		const unsubChunk = bus.on("stream:chunk", (chunk?: string) => {
			if (!this.autoPlay || !chunk) return;
			for (const s of this.segmenter.push(chunk)) this.enqueue(s);
		});

		const unsubDone = bus.on("stream:done", () => {
			this.streamDone = true;
			if (!this.autoPlay) return;
			for (const s of this.segmenter.flush()) this.enqueue(s);
		});

		const unsubBeforeSend = bus.on("chat:beforeSend", () => {
			this.player.prime();
			this.stop();
		});

		const unsubEmotion = bus.on(
			"emotion:changed",
			(data: { state: string }) => {
				this.currentEmotion = (data.state in EMOTION_LABELS ? data.state : "neutral") as EmotionState;
				this.fallbackProvider.emotion = data.state;
			},
		);

		this.unsubs = [unsubChunk, unsubDone, unsubBeforeSend, unsubEmotion];
	}

	detach(): void {
		for (const fn of this.unsubs) fn();
		this.unsubs = [];
		this.stop();
		this.bus = null;
	}

	/** Manual replay path — routes through the same streaming pipeline. */
	speak(text: string): void {
		const cleaned = cleanTTSText(text).slice(0, MAX_TTS_LENGTH);
		if (cleaned) this.enqueue(cleaned);
	}

	stop(): void {
		this.queue.length = 0;
		this.segmenter.reset();
		this.streamDone = false;
		this.replyDegraded = false;
		this.started = false;
		this.abortCtl?.abort();
		this.abortCtl = null;
		this.player.stop();
		this.fallbackProvider.stop();
		try { window.speechSynthesis?.cancel(); } catch { /* ignore */ }
	}

	private enqueue(sentence: string): void {
		if (!sentence) return;
		this.queue.push(sentence);
		void this.processQueue();
	}

	private async processQueue(): Promise<void> {
		if (this.processing) return;
		this.processing = true;
		this.replyStart = performance.now();
		this.firstChunkMs = null;
		try {
			while (this.queue.length > 0) {
				const sentence = this.queue.shift();
				if (!sentence) break;
				await this.speakSentence(sentence);
			}
		} finally {
			this.processing = false;
			if (this.streamDone) await this.finishReply();
		}
	}

	private async finishReply(): Promise<void> {
		await this.player.waitIdle();
		if (!this.started) return;
		this.bus?.emit("tts:end", "");
		this.bus?.emit("tts:provider-status", {
			provider: this.lastProvider,
			latencyMs: this.firstChunkMs ?? Math.round(performance.now() - this.replyStart),
		});
	}

	private async speakSentence(sentence: string): Promise<void> {
		if (this.recordId && !this.replyDegraded) {
			let gotAudio = false;
			try {
				this.abortCtl = new AbortController();
				const stream = await this.emotionProvider.stream(
					sentence,
					this.recordId,
					this.abortCtl.signal,
				);
				const bytes = await this.player.playStream(stream, () => {
					gotAudio = true;
					if (this.firstChunkMs === null) {
						this.firstChunkMs = Math.round(performance.now() - this.replyStart);
					}
					this.markStarted(sentence);
				});
				if (bytes > 0) {
					this.lastProvider = this.emotionProvider.providerName;
					return;
				}
			} catch (err) {
				if (this.abortCtl?.signal.aborted) return; // stopped intentionally
				if (err instanceof TTSCircuitOpenError) {
					this.replyDegraded = true;
				}
				if (gotAudio) return; // partial audio already played — no replay
			}
		}
		this.lastProvider = this.fallbackProvider.providerName;
		this.bus?.emit("tts:degraded", { provider: this.fallbackProvider.providerName });
		this.fallbackProvider.emotion = this.currentEmotion;
		this.markStarted(sentence);
		await this.fallbackProvider.speak(sentence);
	}

	private markStarted(sentence: string): void {
		if (this.started) return;
		this.started = true;
		this.bus?.emit("tts:start", sentence);
	}
}
