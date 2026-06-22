// frontend/src/engine/ScoreManager.ts
import { api } from "@/api/axios-instance";
import type { MessageBus, ScoreData, ScorePhase, ScoringProgress } from "./types";

/** Per-record handlers for SSE scoring progress — avoids single-global overwrite when multiple ScoreManagers coexist */
const _sseHandlers = new Map<number, (data: { record_id: number; stage: string; percent: number; message: string; thought?: string }) => void>();

export function notifySSEProgress(data: { record_id: number; stage: string; percent: number; message: string; thought?: string }) {
	_sseHandlers.get(data.record_id)?.(data);
}

export class ScoreManager {
	private recordId: number | null;
	private bus: MessageBus | null;
	private _score: ScoreData | null = null;
	private _progress: ScoringProgress = { phase: null, percentage: 0, message: "" };
	private _polling = false;
	private pollTimer: ReturnType<typeof setInterval> | null = null;
	private listeners: Array<() => void> = [];
	private _visibilityHandler: (() => void) | null = null;
	private _sseThought: string = "";

	private _registeredHandler: ((data: { record_id: number; stage: string; percent: number; message: string; thought?: string }) => void) | null = null;

	constructor(recordId: number | null, bus?: MessageBus) {
		this.recordId = recordId;
		this.bus = bus ?? null;
		if (recordId) {
			this._registeredHandler = this.onSSEProgress.bind(this);
			_sseHandlers.set(recordId, this._registeredHandler);
		}
	}

	get score(): ScoreData | null { return this._score; }
	get progress(): ScoringProgress { return this._progress; }
	get polling(): boolean { return this._polling; }

	subscribe(fn: () => void): () => void {
		this.listeners.push(fn);
		return () => { this.listeners = this.listeners.filter((l) => l !== fn); };
	}

	private notify(): void {
		for (const fn of this.listeners) fn();
		if (this.bus && this._score) {
			this.bus.emit("score:ready", this._score);
		}
	}

	/** Emit score:ready only when _score is available; fall back to score:unavailable otherwise */
	private notifyScoreReady(): void {
		if (!this.bus) return;
		if (this._score) {
			this.bus.emit("score:ready", this._score);
		} else {
			this.bus.emit("score:unavailable", { record_id: this.recordId });
		}
	}

	async end(): Promise<void> {
		if (!this.recordId) return;
		if (this._polling || this._progress.phase === "completed") return;
		this._progress = { phase: "loading", percentage: 5, message: "正在结束训练..." };
		this.notify();
		try {
			await api.post(`/training/${this.recordId}/end`);
		} catch (e) {
			this._progress = { phase: "failed", percentage: 0, message: "结束训练失败，请重试" };
			this.notify();
			throw e;
		}
		this._progress = { phase: "loading", percentage: 10, message: "评分已触发，等待后台处理..." };
		this.notify();
		this.startPolling();
	}

	private startPolling(): void {
		if (this._polling || !this.recordId) return;
		this._polling = true;
		const POLL_INTERVAL = 1500;
		let retries = 0;
		const maxRetries = 200;

		const poll = async () => {
			if (!this._polling) return;
			// Don't count retries when the tab is hidden — reschedule instead
			if (document.hidden) {
				setTimeout(() => poll(), POLL_INTERVAL);
				return;
			}
			if (retries >= maxRetries) {
				this._progress = { phase: "failed", percentage: 0, message: "评分超时" };
				this.stopPolling();
				this.notify();
				return;
			}
			retries++;
			try {
				const res = await api.get(`/training/${this.recordId}/scoring-status`);
				const data = res.data as {
					scoring_status?: string;
					scoring_error?: string | null;
					score?: { total_score?: number } | null;
					progress?: { phase: string; percentage: number; message: string } | null;
				};
				if (data.scoring_status === "failed") {
					this._progress = {
						phase: "failed",
						percentage: 0,
						message: data.scoring_error || "评分失败",
					};
					this.stopPolling();
					this.notify();
					return;
				}
				if (data.scoring_status === "completed") {
					this._progress = { phase: "completed", percentage: 100, message: "评分完成" };
					this.stopPolling();
					try {
						const detail = await api.get(`/training/records/${this.recordId}`);
						const record = detail.data as { score?: ScoreData | null };
						if (record.score?.detail_scores) {
							this._score = record.score;
						} else if (data.score?.total_score != null) {
							this._score = { total_score: data.score.total_score } as ScoreData;
						}
					} catch {
						if (data.score?.total_score != null) {
							this._score = { total_score: data.score.total_score } as ScoreData;
						}
					}
					this.notifyScoreReady();
					return;
				}
				// Use backend real progress if available
				if (data.progress) {
					const VALID_PHASES = ["loading", "scoring", "feedback", "saving", "completed", "failed", "processing"] as const;
					const phase = VALID_PHASES.includes(data.progress.phase as any)
						? (data.progress.phase as ScorePhase)
						: null;
					this._progress = {
						phase,
						percentage: data.progress.percentage,
						message: data.progress.message,
					};
				} else {
					const pct = Math.min(95, 10 + retries * 1.5);
					this._progress = { phase: "processing", percentage: pct, message: "评分处理中..." };
				}
				this.notify();
			} catch {
				if (retries >= maxRetries - 5) {
					this._progress = { phase: "failed", percentage: 0, message: "评分状态查询失败" };
					this.stopPolling();
					this.notify();
					return;
				}
				const pct = Math.min(95, 10 + retries * 1.5);
				this._progress = { phase: "processing", percentage: pct, message: "评分处理中..." };
				this.notify();
			}
		};

		this.pollTimer = setInterval(poll, POLL_INTERVAL);
		this._visibilityHandler = () => { if (!document.hidden) poll(); };
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
		if (this.recordId) _sseHandlers.delete(this.recordId);
		this._registeredHandler = null;
		this.bus = null;
		this.listeners = [];
		this._score = null;
		this._progress = { phase: null, percentage: 0, message: "" };
		this._visibilityHandler = null;
		this._sseThought = "";
	}

	reset(): void {
		this.stopPolling();
		this._score = null;
		this._progress = { phase: null, percentage: 0, message: "" };
		this._sseThought = "";
		this.notify();
	}

	setRecordId(id: number | null): void {
		if (this.recordId) _sseHandlers.delete(this.recordId);
		this.recordId = id;
		this.reset();
		if (id) {
			this._registeredHandler = this.onSSEProgress.bind(this);
			_sseHandlers.set(id, this._registeredHandler);
		}
	}

	/** Receive real-time SSE scoring progress (from useScoringNotifications hook) */
	onSSEProgress(data: { record_id: number; stage: string; percent: number; message: string; thought?: string }): void {
		if (data.record_id !== this.recordId) return;
		if (data.thought) {
			this._sseThought = data.thought;
		}
		const VALID_PHASES = ["loading", "scoring", "feedback", "saving", "completed", "failed", "processing"] as const;
		const phase = VALID_PHASES.includes(data.stage as any)
			? (data.stage as ScorePhase)
			: null;
		this._progress = {
			phase,
			percentage: data.percent,
			message: data.message,
			thought: this._sseThought,
		};
		this.notify();
	}
}
