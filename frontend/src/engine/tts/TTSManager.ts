import type { MessageBus } from "../types";
import { createBrowserTTS } from "./browser-tts";
import { PcmStreamPlayer } from "./pcm-player";
import { MAX_TTS_LENGTH, SentenceSegmenter } from "./segmenter";
import type { TTSManagerConfig, TTSProvider } from "./types";
import { TTSCircuitOpenError, VolcTTSProvider } from "./VolcTTSProvider";

/**
 * TTSManager — sentence-pipelined playback for the current patient SSE reply.
 *
 * It receives raw LLM chunks, starts synthesis at sentence boundaries, and
 * schedules PCM audio as its bytes arrive. A reply snapshots the auto-play
 * setting at `chat:beforeSend`: turning it on affects the next reply, while
 * turning it off immediately stops the current reply.
 */
export class TTSManager {
	private emotionProvider = new VolcTTSProvider();
	private fallbackProvider: TTSProvider = createBrowserTTS();
	private player = new PcmStreamPlayer();
	private segmenter = new SentenceSegmenter(MAX_TTS_LENGTH);
	private bus: MessageBus | null = null;
	private autoPlay: boolean;
	private recordId: number | null;
	private currentEmotion = "neutral";
	private unsubs: Array<() => void> = [];
	private queue: string[] = [];
	private processing = false;
	private streamDone = false;
	private replyDegraded = false;
	private abortCtl: AbortController | null = null;
	private replyStart = 0;
	private firstChunkMs: number | null = null;
	private started = false;
	private replyFinished = false;
	private replyAutoPlay = false;
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
		if (!on) {
			this.stop();
			return;
		}
		void this.player.prime().catch(() => undefined);
	}

	setRecordId(id: number): void {
		this.recordId = id;
	}

	attach(bus: MessageBus): void {
		this.bus = bus;

		const unsubChunk = bus.on("stream:chunk", (chunk?: string) => {
			if (!this.replyAutoPlay || !chunk) return;
			for (const s of this.segmenter.push(chunk)) this.enqueue(s);
		});

		const completeStream = this.completeStream.bind(this);
		const unsubDone = bus.on("stream:done", completeStream);
		// SSE 失败后仍会保留已显示的部分回复：将已收到文本收尾播放，
		// 而不是让 initiative UI 永久停在 tts:start 状态。
		const unsubError = bus.on("stream:error", completeStream);

		const unsubBeforeSend = bus.on("chat:beforeSend", () => {
			this.stop();
			this.replyAutoPlay = this.autoPlay;
			if (this.replyAutoPlay) void this.player.prime().catch(() => undefined);
		});

		const unsubEmotion = bus.on(
			"emotion:changed",
			(data: { state?: string; dominant_state?: string }) => {
				const label = data.dominant_state ?? data.state ?? "neutral";
				this.currentEmotion = label;
				this.fallbackProvider.emotion = label;
			},
		);

		this.unsubs = [unsubChunk, unsubDone, unsubError, unsubBeforeSend, unsubEmotion];
	}

	detach(): void {
		for (const fn of this.unsubs) fn();
		this.unsubs = [];
		this.stop();
		this.player.dispose();
		this.bus = null;
	}

	/**
	 * Stop the active reply.  There is no standalone replay surface: every TTS
	 * request is driven by the current streamed patient reply.
	 */
	stop(): void {
		const hadPlayback = this.started;
		this.queue.length = 0;
		this.segmenter.reset();
		this.streamDone = false;
		this.replyAutoPlay = false;
		this.replyDegraded = false;
		this.replyFinished = false;
		this.started = false;
		this.abortCtl?.abort();
		this.abortCtl = null;
		this.player.stop();
		this.fallbackProvider.stop();
		try { window.speechSynthesis?.cancel(); } catch { /* ignore */ }
		if (hadPlayback) this.bus?.emit("tts:end", "");
	}

	/** Completes normal and failed SSE replies through the same drain path. */
	private completeStream(): void {
		this.streamDone = true;
		if (!this.replyAutoPlay) return;
		for (const sentence of this.segmenter.flush()) this.enqueue(sentence);
		if (!this.processing && this.queue.length === 0) void this.finishReply();
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
		if (this.replyFinished) return;
		this.replyFinished = true;
		await this.player.waitIdle();
		if (!this.started) return;
		this.started = false;
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
		if (!this.replyAutoPlay || this.started) return;
		this.started = true;
		this.bus?.emit("tts:start", sentence);
	}
}
