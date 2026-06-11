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
  private _visibilityHandler: (() => void) | null = null;

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
    const maxRetries = 100;

    const poll = async () => {
      if (!this._polling || document.hidden) return;
      if (retries >= maxRetries) {
        this.stopPolling();
        return;
      }
      try {
        const res = await api.get(`/training/${this.recordId}/scoring-status`);
        const data = res.data as { scoring_status?: string; scoring_error?: string | null; score?: { total_score?: number } | null };
        if (data.scoring_status === "failed") {
          this._progress = 0;
          this.stopPolling();
          this.notify();
          return;
        }
        if (data.score && data.score.total_score !== undefined) {
          this._score = data.score as ScoreData;
          this._progress = 100;
          this.stopPolling();
          this.notify();
          return;
        }
        this._progress = Math.min(95, 30 + retries * 2);
        this.notify();
      } catch {
        this._progress = Math.min(95, 30 + retries * 2);
        this.notify();
      }
      retries++;
    };

    this.pollTimer = setInterval(poll, 3000);
    this._visibilityHandler = () => {
      if (!document.hidden) poll();
    };
    document.addEventListener("visibilitychange", this._visibilityHandler);
    poll();
  }

  stopPolling(): void {
    this._polling = false;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (this._visibilityHandler) {
      document.removeEventListener("visibilitychange", this._visibilityHandler);
      this._visibilityHandler = null;
    }
    this.notify();
  }

  dispose(): void {
    this.stopPolling();
    this.bus = null;
    this.listeners = [];
    this._score = null;
    this._progress = 0;
    this._visibilityHandler = null;
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
