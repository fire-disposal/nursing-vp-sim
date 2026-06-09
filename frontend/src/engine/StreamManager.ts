// frontend/src/engine/StreamManager.ts
import { sendMessageStream } from "@/api/api-client";
import type { ChatMessage } from "./types";

export interface StreamCallbacks {
  onPatientChunk?: (chunk: string) => void;
  onPatientDone?: (replyId?: number) => void;
  onError?: (err: string) => void;
  onSanitized?: (reply: string) => void;
  onSystem?: (text: string) => void;
}

export class StreamManager {
  private recordId: number | null;
  private messages: ChatMessage[] = [];
  private listeners: Array<() => void> = [];
  private abortController: AbortController | null = null;
  private _loading = false;
  private loadingListeners: Array<(l: boolean) => void> = [];

  constructor(recordId: number | null) {
    this.recordId = recordId;
  }

  getMessages(): ChatMessage[] {
    return this.messages;
  }

  get loading(): boolean {
    return this._loading;
  }

  setRecordId(id: number | null): void {
    this.recordId = id;
  }

  setMessages(msgs: ChatMessage[]): void {
    this.messages = msgs;
    this.notify();
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

  private notify(): void {
    for (const fn of this.listeners) fn();
  }

  private setLoading(v: boolean): void {
    this._loading = v;
    for (const fn of this.loadingListeners) fn(v);
  }

  abort(): void {
    this.abortController?.abort();
    this.abortController = null;
    this.setLoading(false);
  }

  private isOperation(content: string): boolean {
    return content.startsWith("/") || content.startsWith("测") || content.startsWith("观察");
  }

  async send(content: string, callbacks: StreamCallbacks = {}): Promise<void> {
    if (!this.recordId || this._loading) return;
    this.setLoading(true);

    const op = this.isOperation(content);
    const addedIds = new Set<string>();

    if (!op) {
      const studentId = crypto.randomUUID();
      addedIds.add(studentId);
      this.messages = [...this.messages, { id: studentId, role: "student", content }];
      this.notify();
    } else {
      const sysId = crypto.randomUUID();
      addedIds.add(sysId);
      this.messages = [...this.messages, { id: sysId, role: "system", content: `正在${content}...` }];
      this.notify();
    }

    if (!op) {
      const placeholderId = crypto.randomUUID();
      addedIds.add(placeholderId);
      this.messages = [...this.messages, { id: placeholderId, role: "patient", content: "", streaming: true }];
      this.notify();
    }

    const controller = new AbortController();
    this.abortController = controller;

    try {
      await sendMessageStream(
        this.recordId,
        content,
        (chunk) => {
          const msgs = [...this.messages];
          for (let i = msgs.length - 1; i >= 0; i--) {
            if (msgs[i]?.streaming) {
              msgs[i] = { ...msgs[i], content: msgs[i].content + chunk };
              this.messages = msgs;
              this.notify();
              break;
            }
          }
          callbacks.onPatientChunk?.(chunk);
        },
        (doneId) => {
          const msgs = [...this.messages];
          for (let i = msgs.length - 1; i >= 0; i--) {
            if (msgs[i]?.streaming) {
              msgs[i] = { ...msgs[i], streaming: false, id: doneId || msgs[i].id };
              this.messages = msgs;
              this.notify();
              break;
            }
          }
          callbacks.onPatientDone?.(doneId);
          this.setLoading(false);
          if (this.abortController === controller) this.abortController = null;
        },
        (err) => {
          this.messages = this.messages.filter((m) => !m.streaming && !addedIds.has(String(m.id ?? "")));
          this.notify();
          this.setLoading(false);
          callbacks.onError?.(err);
          if (this.abortController === controller) this.abortController = null;
        },
        (reply) => callbacks.onSanitized?.(reply),
        (sysMsg) => {
          this.messages = [...this.messages, { id: crypto.randomUUID(), role: "system", content: sysMsg }];
          this.notify();
        },
        controller.signal,
      );
    } catch (err: any) {
      this.messages = this.messages.filter((m) => !m.streaming && !addedIds.has(String(m.id ?? "")));
      this.notify();
      this.setLoading(false);
      callbacks.onError?.(err?.message || "发送失败");
    } finally {
      if (this.abortController === controller) this.abortController = null;
    }
  }
}
