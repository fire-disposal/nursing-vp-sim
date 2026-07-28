/**
 * StreamManager — SSE 流式对话编排器。
 *
 * Zustand 迁移后不再持有 messages 数组；消息全部通过 trainingStore 管理。
 * 本类仅负责：SSE 回调→store action 的接线、AbortController 生命周期、loading 状态。
 */
import { sendMessageStream } from "@/api";
import type { InitiativeStateData } from "@/api/sse";
import { getTrainingState } from "@/stores/trainingStore";

export interface StreamCallbacks {
	onPatientChunk?: (chunk: string) => void;
	onPatientDone?: (replyId?: number) => void;
	onError?: (err: string) => void;
	onSystem?: (text: string) => void;
	onEmotionChange?: (change: {
		state: string;
		trust: number;
		comfort: number;
	}) => void;
	onInitiative?: (data: { content: string }) => void;
	onInitiativeState?: (data: InitiativeStateData) => void;
}

export class StreamManager {
	private recordId: number | null;
	private abortController: AbortController | null = null;

	constructor(recordId: number | null) {
		this.recordId = recordId;
	}

	setRecordId(id: number | null): void {
		this.recordId = id;
	}

	abort(): void {
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
					store.appendChunk(placeholderId, chunk);
					callbacks.onPatientChunk?.(chunk);
				},
				(doneId) => {
					store.finalizeMessage(placeholderId, doneId);
					callbacks.onPatientDone?.(doneId);
				},
				(err) => {
					const msgs = store.messages;
					const partial = msgs.find((m) => m.id === placeholderId);
					const hasContent = !!(partial?.content.trim());
					store.handleStreamError(studentId, placeholderId, err, hasContent);
					callbacks.onError?.(err);
				},
				(sysMsg) => {
					callbacks.onSystem?.(sysMsg);
				},
				controller.signal,
				(emotionChange) => callbacks.onEmotionChange?.(emotionChange),
				(initiative) => {
					callbacks.onInitiative?.(initiative);
				},
				(initiativeState) => callbacks.onInitiativeState?.(initiativeState),
			);
		} catch (err: unknown) {
			const msgs = store.messages;
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
			if (this.abortController === controller) {
				this.abortController = null;
				getTrainingState().setSending(false);
			}
		}
	}
}
