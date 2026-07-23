import { sendMessageStream } from "@/api";
import type { InitiativeStateData } from "@/api/sse";
import type { ChatMessage } from "./types";

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
	private messages: ChatMessage[] = [];
	private listeners: Array<() => void> = [];
	private abortController: AbortController | null = null;
	private _loading = false;
	private loadingListeners: Array<(l: boolean) => void> = [];
	private _rafId: number | null = null;

	constructor(recordId: number | null) {
		this.recordId = recordId;
	}

	getMessages(): ChatMessage[] {
		return this.messages;
	}

	addPatientMessage(text: string): void {
		this.messages = [
			...this.messages,
			{
				role: "patient",
				content: text,
				streaming: false,
				timestamp: Date.now().toString(),
			},
		];
		this.notifySync();
	}

	get loading(): boolean {
		return this._loading;
	}

	setRecordId(id: number | null): void {
		this.recordId = id;
	}

	setMessages(msgs: ChatMessage[]): void {
		this.messages = msgs;
		this.notifySync();
	}

	/**
	 * 幂等合并服务器历史消息（useTrainingRecord 15s 轮询回填）。
	 *
	 * 本地流式消息的 id 是 UUID（学生消息）或 number（患者消息，来自 SSE done
	 * 事件），而服务器历史 id 统一为 string —— 仅靠 id 判重必然漏配，
	 * 导致每轮对话在轮询后被重复追加一次（生产事故）。
	 * 因此采用双判重：id（归一化为 string）+ role:content 内容指纹。
	 *
	 * 内容指纹安全性：服务器侧每条消息都由本地流式先行产生，
	 * 轮询回来的同内容消息必是重复的；真正的历史回填（刷新恢复）内容必然不同。
	 */
	mergeHistory(incoming: ChatMessage[]): number {
		if (incoming.length === 0) return 0;
		const existingIds = new Set(
			this.messages
				.map((m) => m.id)
				.filter((id) => id != null)
				.map(String),
		);
		const existingContent = new Set(
			this.messages.map((m) => `${m.role}:${m.content}`),
		);
		const fresh = incoming.filter((m) => {
			if (m.id != null && existingIds.has(String(m.id))) return false;
			if (existingContent.has(`${m.role}:${m.content}`)) return false;
			return true;
		});
		if (fresh.length === 0) return 0;
		this.messages.push(...fresh);
		this.notifySync();
		return fresh.length;
	}

	subscribe(fn: () => void): () => void {
		this.listeners.push(fn);
		return () => {
			this.listeners = this.listeners.filter((l) => l !== fn);
		};
	}

	onLoadingChange(fn: (loading: boolean) => void): () => void {
		this.loadingListeners.push(fn);
		return () => {
			this.loadingListeners = this.loadingListeners.filter((l) => l !== fn);
		};
	}

	private notifySync(): void {
		this._cancelRaf();
		for (const fn of this.listeners) fn();
	}

	private scheduleNotify(): void {
		if (this._rafId === null) {
			this._rafId = requestAnimationFrame(() => {
				this._rafId = null;
				this.notifySync();
			});
		}
	}

	private _cancelRaf(): void {
		if (this._rafId !== null) {
			cancelAnimationFrame(this._rafId);
			this._rafId = null;
		}
	}

	private setLoading(v: boolean): void {
		this._loading = v;
		for (const fn of this.loadingListeners) fn(v);
	}

	private findStreaming(): ChatMessage | undefined {
		for (let i = this.messages.length - 1; i >= 0; i--) {
			if (this.messages[i]?.streaming) return this.messages[i];
		}
		return undefined;
	}

	abort(): void {
		this.abortController?.abort();
		this.abortController = null;
		this.messages = this.messages.filter((m) => !m.streaming);
		this.setLoading(false);
		this.notifySync();
	}

  dispose(): void {
    this.abort();
    this._cancelRaf();
    this.listeners = [];
    this.loadingListeners = [];
  }

  async send(content: string, callbacks: StreamCallbacks = {}): Promise<void> {
    if (this._loading) {
      console.warn("[StreamManager] send() called while already sending — ignoring");
      return;
    }
    this.setLoading(true);
    this.abortController?.abort(); // Abort any previous in-flight stream
    if (!this.recordId) {
      this.setLoading(false);
      console.warn("[StreamManager] send() called with null recordId — dropping message");
      callbacks.onError?.("训练尚未就绪，请稍后重试");
      return;
    }

		const studentId = crypto.randomUUID();
		this.messages = [
			...this.messages,
			{ id: studentId, role: "student", content },
		];
		this.notifySync();

		const placeholderId = crypto.randomUUID();
		this.messages = [
			...this.messages,
			{ id: placeholderId, role: "patient", content: "", streaming: true },
		];
		this.notifySync();

		const controller = new AbortController();
		this.abortController = controller;

		try {
			await sendMessageStream(
				this.recordId,
				content,
				(chunk) => {
					const msg = this.findStreaming();
					if (msg) {
						this.messages = this.messages.map(m =>
							m.id === msg.id ? { ...m, content: m.content + chunk } : m
						);
					}
					this.scheduleNotify();
					callbacks.onPatientChunk?.(chunk);
				},
				(doneId) => {
					const msg = this.findStreaming();
					if (msg) {
						this.messages = this.messages.map(m =>
							m.id === msg.id
								? { ...m, streaming: false, ...(doneId ? { id: String(doneId) } : {}) }
								: m
						);
					}
					this.notifySync();
					callbacks.onPatientDone?.(doneId);
					this.setLoading(false);
					if (this.abortController === controller) this.abortController = null;
				},
				(err) => {
					const partial = this.findStreaming();
					if (partial?.content.trim()) {
						this.messages = this.messages.map(m =>
							m.id === partial.id ? { ...m, streaming: false, streamError: err } : m
						);
					} else {
						this.messages = this.messages.filter(
							(m) => !m.streaming && m.id !== placeholderId && m.id !== studentId,
						);
					}
					this.notifySync();
					this.setLoading(false);
					callbacks.onError?.(err);
					if (this.abortController === controller) this.abortController = null;
				},
				(sysMsg) => {
					this.messages = [
						...this.messages,
						{ id: crypto.randomUUID(), role: "system", content: sysMsg },
					];
					this.notifySync();
					callbacks.onSystem?.(sysMsg);
				},
				controller.signal,
				(emotionChange) => callbacks.onEmotionChange?.(emotionChange),
				(initiative) => {
					if (initiative?.content) {
						this.messages = [
							...this.messages,
							{
								id: crypto.randomUUID(),
								role: "patient",
								content: initiative.content,
							},
						];
						this.notifySync();
					}
					callbacks.onInitiative?.(initiative);
				},
				(initiativeState) => callbacks.onInitiativeState?.(initiativeState),
			);
		} catch (err: unknown) {
			const partial = this.findStreaming();
			if (partial?.content.trim()) {
				this.messages = this.messages.map(m =>
					m.id === partial.id
						? { ...m, streaming: false, streamError: (err as Error)?.message || "发送失败" }
						: m
				);
			} else {
				this.messages = this.messages.filter(
					(m) => !m.streaming && m.id !== placeholderId && m.id !== studentId,
				);
			}
			this.notifySync();
			this.setLoading(false);
			callbacks.onError?.((err as any)?.message || "发送失败");
		} finally {
			if (this.abortController === controller) this.abortController = null;
		}
	}
}
