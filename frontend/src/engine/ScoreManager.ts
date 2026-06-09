// frontend/src/engine/ScoreManager.ts
import { api } from "@/api/axios-instance";
import type { ScoreData } from "./types";

export class ScoreManager {
  private recordId: number | null;
  private _score: ScoreData | null = null;
  private _progress = 0;
  private _polling = false;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private listeners: Array<() => void> = [];

  constructor(recordId: number | null) {
    this.recordId = recordId;
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
        const res = await api.get(`/training/records/${this.recordId}/review`);
        const data = res.data as ScoreData;
        if (data && (data.total_score !== undefined || data.detail_scores)) {
          this._score = data;
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
