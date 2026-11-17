import { createBrowserTTS } from "@/engine/tts/browser-tts";
import { PcmStreamPlayer } from "@/engine/tts/pcm-player";
import { MAX_TTS_LENGTH, SentenceSegmenter } from "@/engine/tts/segmenter";
import { accessHeaders } from "@/utils/accessContext";

/**
 * DemoTTSPlayer —— 演示电话的**独立** TTS 播放器。
 *
 * 与训练链路的 `TTSManager` 完全分开：后者挂在 MessageBus 上、按训练记录播报 SSE 回复，
 * 演示页既不该建 record，也不该复用它的状态。这里只保留两者共同的**线路契约**：
 *   - 请求仍是 PCM 24kHz / 16-bit / 单声道 的字节流（与训练链路同一个播放内核）；
 *   - 鉴权仍是 `Authorization: Bearer <jwt>`。
 *
 * 但端点不同：`POST /api/voice-demo/tts/stream`，body 是
 * `{text, emotion_state, section_id, speaker?}`，响应头 `X-TTS-Emotion` /
 * `X-TTS-Voice` / `X-TTS-Sample-Rate` 回显**服务端实际使用**的情绪与音色。
 *
 * 能力：
 *   1. 逐句流水线：一句话在句读处就送去合成，不等整段说完；
 *   2. 首块延迟：从请求发出到第一块音频开始播放（或浏览器兜底朗读开始）；
 *   3. 打断：`stop()` 立刻 abort 在途请求、清空队列、停播；
 *   4. 队列 + 完成事件：`onEvent` 上报 queued/speaking/first-block/done/fallback；
 *   5. 浏览器兜底：服务端不可用（503/网络错/无音频）时用 `speechSynthesis` 念，
 *      且**整段只兜一次**——中途不来回切，否则学生听到两个声音。
 */

export const DEMO_TTS_PATH = "/api/voice-demo/tts/stream";

export interface DemoTTSRequest {
	text: string;
	emotion_state: string;
	section_id: string;
	speaker?: string;
}

export type DemoTTSPhase = "idle" | "synthesizing" | "speaking" | "stopped";

export interface DemoTTSMeta {
	/** 服务端回显的实际情绪（没有该头时为 null）。 */
	emotion: string | null;
	/** 服务端回显的实际音色（没有该头时为 null）。 */
	voice: string | null;
	/** 服务端回显的采样率；缺省 24000。 */
	sampleRate: number;
}

export type DemoTTSListener = (event:
	| { type: "queued"; sentences: number }
	| { type: "sentence"; text: string; index: number }
	| { type: "synth"; text: string }
	| { type: "first-block"; ms: number; fallback: boolean }
	| { type: "speaking"; text: string }
	| { type: "done"; blocks: number }
	| { type: "fallback"; reason: string }
	| { type: "stopped" }
	| { type: "error"; message: string }) => void;

type DemoTTSPlayerCore = Pick<PcmStreamPlayer, "playStream" | "stop" | "prime" | "waitIdle" | "dispose"> & {
	outputLevel?: () => number;
	readReference?: (startMs: number, length: number) => Float32Array;
};

export interface DemoTTSConfig {
	/** 默认说话人（`speaker` 字段）。 */
	speaker?: string;
	/** 依赖注入（单测用）：发请求返回原始 Response。 */
	fetchImpl?: typeof fetch;
	/** 依赖注入（单测用）：播放内核。 */
	player?: DemoTTSPlayerCore;
	/** 依赖注入（单测用）：浏览器兜底朗读器。 */
	fallback?: {
		speak(text: string): Promise<void>;
		stop(): void;
		readonly speaking: boolean;
		emotion?: string;
	};
}

const MAX_QUEUE = 64;

export class DemoTTSPlayer {
	private player: DemoTTSPlayerCore;
	private fallback: NonNullable<DemoTTSConfig["fallback"]>;
	private fetchImpl: typeof fetch;
	private speaker: string | undefined;
	private segmenter = new SentenceSegmenter(MAX_TTS_LENGTH);
	private queue: string[] = [];
	private abortCtl: AbortController | null = null;
	private listeners = new Set<DemoTTSListener>();
	private processing = false;
	private phaseValue: DemoTTSPhase = "idle";
	private degraded = false;
	private blocks = 0;
	private firstBlockMs: number | null = null;
	private requestedAt = 0;
	private currentMeta: DemoTTSMeta = { emotion: null, voice: null, sampleRate: 24000 };
	private emotion = "neutral";
	private sectionId = "phone-demo";

	constructor(config: DemoTTSConfig = {}) {
		this.player = config.player ?? new PcmStreamPlayer();
		this.fallback = config.fallback ?? createBrowserTTS();
		this.fetchImpl = config.fetchImpl ?? ((...args) => fetch(...args));
		this.speaker = config.speaker;
	}

	get phase(): DemoTTSPhase {
		return this.phaseValue;
	}

	get speaking(): boolean {
		return this.processing || this.phaseValue === "speaking";
	}

	/** 服务端最近一次回显的情绪/音色/采样率。 */
	get meta(): DemoTTSMeta {
		return this.currentMeta;
	}

	/** 首块音频延迟（ms）；本次通话还没有出声时为 null。 */
	get firstBlockLatency(): number | null {
		return this.firstBlockMs;
	}

	/** 当前播放输出 RMS（0..1）：只用于回声门，不参与业务状态。 */
	outputLevel(): number {
		try {
			return this.player.outputLevel?.() ?? 0;
		} catch {
			return 0;
		}
	}

	/** ASR 反相抵消：读取指定时间轴的 16kHz 参考波形。 */
	readReference(startMs: number, length: number): Float32Array {
		return this.player.readReference?.(startMs, length) ?? new Float32Array(length);
	}

	get usingFallback(): boolean {
		return this.degraded;
	}

	subscribe(listener: DemoTTSListener): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	private emit(event: Parameters<DemoTTSListener>[0]): void {
		for (const fn of this.listeners) {
			try {
				fn(event);
			} catch (err) {
				console.error("[demo-tts] 事件处理失败", err);
			}
		}
	}

	/** 一轮对话的情绪/小节：服务端据此挑音色与语气。 */
	setContext(emotion: string, sectionId: string, speaker?: string): void {
		this.emotion = emotion;
		this.sectionId = sectionId;
		if (speaker !== undefined) this.speaker = speaker;
	}

	/** 预建音频图（必须在用户手势里调用，否则浏览器不给出声）。 */
	async prime(): Promise<void> {
		try {
			await this.player.prime();
		} catch {
			/* 浏览器不支持 Web Audio：兜底路径仍可出声 */
		}
	}

	/**
	 * 推送一段文本（SSE 的单个 content 块）。
	 *
	 * 句读处立刻送去合成 —— 流式回复的首块音频因此不等整段说完。
	 * 返回值在**本块产生的句子全部处理完**时 resolve（不是音频播完）。
	 */
	speak(chunk: string): Promise<void> {
		if (!chunk) return Promise.resolve();
		if (this.phaseValue === "idle") this.beginSession();
		const sentences = this.segmenter.push(chunk);
		this.emit({ type: "queued", sentences: sentences.length });
		for (const s of sentences) this.enqueue(s);
		return this.drain();
	}

	/**
	 * 结束本段：把残留的不完整句子也念出来（SSE `done` 时调用），
	 * 并发出「完成」事件（带本次通话播了几块）。
	 */
	finish(): Promise<void> {
		const tail = this.segmenter.flush();
		for (const s of tail) this.enqueue(s);
		const done = this.drain();
		this.emit({ type: "done", blocks: this.blocks });
		return done;
	}

	private beginSession(): void {
		this.degraded = false;
		this.blocks = 0;
		this.firstBlockMs = null;
		this.requestedAt = performance.now();
	}

	/** 等音频真正播完（含最后一句）。 */
	async waitIdle(): Promise<void> {
		await this.player.waitIdle();
		if (this.phaseValue !== "stopped") this.phaseValue = "idle";
	}

	/** 停止：abort 在途请求、清空队列、停播、停兜底朗读。 */
	stop(): void {
		const wasActive = this.phaseValue !== "idle";
		this.queue.length = 0;
		this.segmenter.reset();
		this.abortCtl?.abort();
		this.abortCtl = null;
		this.processing = false;
		this.phaseValue = "stopped";
		this.degraded = false;
		try {
			this.player.stop();
		} catch {
			/* 播放器未创建 */
		}
		try {
			this.fallback.stop();
		} catch {
			/* 浏览器不支持 */
		}
		if (wasActive) this.emit({ type: "stopped" });
		this.phaseValue = "idle";
	}

	dispose(): void {
		this.stop();
		this.listeners.clear();
		try {
			this.player.dispose();
		} catch {
			/* 已释放 */
		}
	}

	private enqueue(sentence: string): void {
		if (!sentence.trim()) return;
		if (this.queue.length >= MAX_QUEUE) {
			this.emit({ type: "error", message: "语音队列已满，已丢弃多余的句子" });
			return;
		}
		this.queue.push(sentence);
	}

	private async drain(): Promise<void> {
		if (this.processing) return;
		this.processing = true;
		this.phaseValue = "synthesizing";
		try {
			let index = 0;
			while (this.queue.length > 0) {
				const sentence = this.queue.shift();
				if (!sentence) break;
				this.emit({ type: "sentence", text: sentence, index });
				index += 1;
				await this.speakSentence(sentence);
			}
		} finally {
			this.processing = false;
			if (this.phaseValue === "synthesizing" || this.phaseValue === "speaking") {
				this.phaseValue = "idle";
			}
		}
	}

	private async speakSentence(sentence: string): Promise<void> {
		if (this.degraded) {
			await this.speakFallback(sentence);
			return;
		}
		const ctl = new AbortController();
		this.abortCtl = ctl;
		let gotAudio = false;
		const onFirstChunk = () => {
			gotAudio = true;
			this.markFirstBlock();
		};
		try {
			// 有回采/回声消除的设备上先建音频图：首块能立刻出声，而不是等 context 启动。
			await this.player.prime().catch(() => undefined);
			const stream = await this.requestStream(sentence, ctl.signal);
			const bytes = await this.player.playStream(stream, onFirstChunk);
			if (bytes > 0) {
				this.blocks += 1;
				this.emit({ type: "speaking", text: sentence });
				return;
			}
			this.emit({ type: "fallback", reason: "服务端没有返回音频" });
		} catch (err) {
			if (ctl.signal.aborted) return;
			this.emit({ type: "fallback", reason: (err as Error)?.message ?? "合成失败" });
		} finally {
			if (this.abortCtl === ctl) this.abortCtl = null;
		}
		// 本句的云端音频没出来 → 本次通话后续都用浏览器兜底（不来回切换音色）。
		if (!gotAudio) this.degraded = true;
		await this.speakFallback(sentence);
	}

	/** 请求契约：JSON body + 三个回显头。503 = 服务端阈值保护，按兜底处理。 */
	private async requestStream(text: string, signal: AbortSignal): Promise<ReadableStream<Uint8Array>> {
		const body: DemoTTSRequest = {
			text,
			emotion_state: this.emotion,
			section_id: this.sectionId,
			...(this.speaker ? { speaker: this.speaker } : {}),
		};
		this.emit({ type: "synth", text });
		const response = await this.fetchImpl(DEMO_TTS_PATH, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				...accessHeaders(),
			},
			body: JSON.stringify(body),
			signal,
		});
		if (!response.ok) {
			const detail = await response.text().catch(() => "");
			throw new Error(`TTS 流失败：HTTP ${response.status}${detail ? ` · ${detail.slice(0, 160)}` : ""}`);
		}
		if (!response.body) throw new Error("TTS 流为空");
		const sampleRate = Number(response.headers?.get("X-TTS-Sample-Rate") ?? 0);
		this.currentMeta = {
			emotion: response.headers?.get("X-TTS-Emotion") ?? null,
			voice: response.headers?.get("X-TTS-Voice") ?? null,
			sampleRate: Number.isFinite(sampleRate) && sampleRate > 0 ? sampleRate : 24000,
		};
		return response.body;
	}

	/** 首块出声（云端或兜底）：只在本次通话的第一块记延迟。 */
	private markFirstBlock(): void {
		if (this.firstBlockMs !== null) return;
		this.firstBlockMs = performance.now() - this.requestedAt;
		this.phaseValue = "speaking";
		this.emit({ type: "first-block", ms: this.firstBlockMs, fallback: this.degraded });
	}

	private async speakFallback(text: string): Promise<void> {
		try {
			this.fallback.emotion = this.emotion;
			this.markFirstBlock();
			await this.fallback.speak(text);
			this.blocks += 1;
		} catch (err) {
			this.emit({ type: "error", message: (err as Error)?.message ?? "浏览器朗读失败" });
		}
	}

}

