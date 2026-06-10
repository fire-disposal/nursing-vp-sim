// frontend/src/engine/ScoreManager.ts
import { api } from "@/api/axios-instance";
import type { MessageBus, ScoreData } from "./types";

export class ScoreManager {
  private recordId: number | null;
  private bus: MessageBus | null;
  private _score: ScoreData | null = null;
  private _progress = 0;
  private _polling = false;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private listeners: Array<() => void> = [];

  constructor(recordId: number | null, bus?: MessageBus) {
    this.recordId = recordId;
    this.bus = bus ?? null;
  }

  get score(): ScoreData | null {
    return this._score;
  }
  get progress(): number {
    return this._progress;
  }
  get polling(): boolean {
    return this._polling;
  }

  subscribe(fn: () => void): () => void {
    this.listeners.push(fn);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== fn);
    };
  }

  private notify(): void {
    for (const fn of this.listeners) fn();
    if (this.bus && this._score) {
      this.bus.emit("score:ready", this._score);
    }
  }

  async end(): Promise<void> {
    if (!this.recordId) return;
    this._progress = 10;
    this.notify();
    await api.post(`/training/${this.recordId}/end`);
    this._progress = 30;
    this.notify();
    this.startPolling();
  }

  private startPolling(): void {
    if (this._polling || !this.recordId) return;
    this._polling = true;
    let retries = 0;
    const maxRetries = 40;

    this.pollTimer = setInterval(async () => {
      if (retries >= maxRetries) {
        this.stopPolling();
        return;
      }
      try {
        const res = await api.get(`/training/records/${this.recordId}`);
        const score = res.data?.score;
        if (score && (score.total_score !== undefined || score.detail_scores)) {
          this._score = score as ScoreData;
          this._progress = 100;
          this.stopPolling();
          this.notify();
        } else {
          this._progress = Math.min(95, 30 + retries * 2);
          this.notify();
        }
      } catch {
        this._progress = Math.min(95, 30 + retries * 2);
        this.notify();
      }
      retries++;
    }, 3000);
  }

  stopPolling(): void {
    this._polling = false;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this.notify();
  }

  dispose(): void {
    this.stopPolling();
    this.bus = null;
    this.listeners = [];
    this._score = null;
    this._progress = 0;
  }

  reset(): void {
    this.stopPolling();
    this._score = null;
    this._progress = 0;
    this.notify();
  }

  setRecordId(id: number | null): void {
    this.recordId = id;
    this.reset();
  }
}
