/**
 * StreamManager — SSE 流式对话编排器。
 *
 * Zustand 迁移后不再持有 messages 数组；消息全部通过 trainingStore 管理。
 * 本类仅负责：SSE 回调→store action 的接线、AbortController 生命周期、loading 状态。
 */
import { correctLastMessageStream, sendMessageStream } from "@/api";
import type { InitiativeStateData } from "@/api/sse";
import { getTrainingState } from "@/stores/trainingStore";

export interface StreamCallbacks {
	onPatientChunk?: (chunk: string) => void;
	onPatientDone?: (replyId?: number) => void;
	onError?: (err: string) => void;
	onEmotionChange?: (change: {
		state: string;
		trust: number;
		comfort: number;
	}) => void;
	onInitiativeState?: (data: InitiativeStateData) => void;
}

export class StreamManager {
	private recordId: number | null;
	private abortController: AbortController | null = null;
	// 流式批量写入：rAF 合并 store 更新（避免每 token 一次全量重渲染），
	// TTS/滚动仍逐 chunk 消费 bus 事件，合成延迟不受影响。
	private chunkBuffer = new Map<string, string>();
	private chunkRaf: number | null = null;

	constructor(recordId: number | null) {
		this.recordId = recordId;
	}

	private enqueueChunk(placeholderId: string, chunk: string): void {
		this.chunkBuffer.set(
			placeholderId,
			(this.chunkBuffer.get(placeholderId) ?? "") + chunk,
		);
		if (typeof requestAnimationFrame === "undefined") {
			this.flushChunks();
			return;
		}
		if (this.chunkRaf != null) return;
		this.chunkRaf = requestAnimationFrame(() => {
			this.chunkRaf = null;
			this.flushChunks();
		});
	}

	/** 同步落盘缓冲的 chunk（结束/出错/中止时必须先调用，保证内容完整） */
	private flushChunks(): void {
		if (this.chunkRaf != null) {
			cancelAnimationFrame(this.chunkRaf);
			this.chunkRaf = null;
		}
		if (this.chunkBuffer.size === 0) return;
		const buffer = this.chunkBuffer;
		this.chunkBuffer = new Map();
		const store = getTrainingState();
		for (const [pid, text] of buffer) {
			store.appendChunk(pid, text);
		}
	}

	setRecordId(id: number | null): void {
		this.recordId = id;
	}

	abort(): void {
		this.flushChunks();
		this.abortController?.abort();
		this.abortController = null;
		getTrainingState().setSending(false);
	}

	dispose(): void {
		this.abort();
	}

	async send(content: string, callbacks: StreamCallbacks = {}): Promise<void> {
		const store = getTrainingState();
		if (store.sending) {
			console.warn("[StreamManager] send() called while already sending — ignoring");
			return;
		}
		if (!this.recordId) {
			console.warn("[StreamManager] send() called with null recordId — dropping message");
			callbacks.onError?.("训练尚未就绪，请稍后重试");
			return;
		}

		store.setSending(true);

		const { studentId, placeholderId } = store.addStudentMessage(content);

		const controller = new AbortController();
		this.abortController = controller;

		try {
			await sendMessageStream(
				this.recordId,
				content,
				(chunk) => {
					this.enqueueChunk(placeholderId, chunk);
					callbacks.onPatientChunk?.(chunk);
				},
				(doneId) => {
					this.flushChunks();
					store.finalizeMessage(placeholderId, doneId);
					callbacks.onPatientDone?.(doneId);
				},
				(err) => {
					this.flushChunks();
					// zustand set() 每次生成新 state 对象 —— 必须实时取，否则读到的永远是发送前的空数组
					const msgs = getTrainingState().messages;
					const partial = msgs.find((m) => m.id === placeholderId);
					const hasContent = !!(partial?.content.trim());
					store.handleStreamError(studentId, placeholderId, err, hasContent);
					callbacks.onError?.(err);
				},
				controller.signal,
				(emotionChange) => callbacks.onEmotionChange?.(emotionChange),
				(initiativeState) => callbacks.onInitiativeState?.(initiativeState),
			);
		} catch (err: unknown) {
			const msgs = getTrainingState().messages;
			const partial = msgs.find((m) => m.id === placeholderId);
			const hasContent = !!(partial?.content.trim());
			store.handleStreamError(
				studentId,
				placeholderId,
				(err as Error)?.message || "发送失败",
				hasContent,
			);
			callbacks.onError?.((err as Error)?.message || "发送失败");
		} finally {
			this.flushChunks();
			if (this.abortController === controller) {
				this.abortController = null;
				getTrainingState().setSending(false);
			}
		}
	}

	async correctLastMessage(messageId: string | number, content: string, callbacks: StreamCallbacks = {}): Promise<void> {
		const store = getTrainingState();
		if (store.sending) {
			console.warn("[StreamManager] correctLastMessage() called while already sending — ignoring");
			return;
		}
		if (!this.recordId) {
			callbacks.onError?.("训练尚未就绪，请稍后重试");
			return;
		}

		const snapshot = store.beginCorrection(messageId, content);
		if (!snapshot) {
			callbacks.onError?.("只能修正最近一次发言");
			return;
		}

		store.setSending(true);
		const controller = new AbortController();
		this.abortController = controller;

		try {
			await correctLastMessageStream(
				this.recordId,
				content,
				(chunk) => {
					this.enqueueChunk(snapshot.placeholderId, chunk);
					callbacks.onPatientChunk?.(chunk);
				},
				(done) => {
					this.flushChunks();
					store.finalizeCorrection(snapshot, done);
					callbacks.onPatientDone?.(done.patient_id ?? done.id);
				},
				(err) => {
					this.flushChunks();
					store.rollbackCorrection(snapshot);
					callbacks.onError?.(err);
				},
				controller.signal,
				(emotionChange) => callbacks.onEmotionChange?.(emotionChange),
				(initiativeState) => callbacks.onInitiativeState?.(initiativeState),
			);
		} catch (err: unknown) {
			store.rollbackCorrection(snapshot);
			callbacks.onError?.((err as Error)?.message || "修正失败");
		} finally {
			this.flushChunks();
			if (this.abortController === controller) {
				this.abortController = null;
				getTrainingState().setSending(false);
			}
		}
	}
}
