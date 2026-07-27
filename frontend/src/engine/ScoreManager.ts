// frontend/src/engine/ScoreManager.ts
import { api } from "@/api/client";
import { retryScoring } from "@/api/training";
import type { MessageBus, ScoreData, ScorePhase, ScoringProgress } from "./types";

/** 相位顺序 — 用于拒绝乱序/回退的进度更新（WS 推送与 HTTP 轮询共用） */
const PHASE_ORDER: Record<string, number> = {
	loading: 0,
	scoring: 1,
	feedback: 2,
	saving: 3,
	completed: 4,
};

const VALID_PHASES = ["loading", "scoring", "feedback", "saving", "completed", "failed", "processing"] as const;

/** Per-record handlers for SSE scoring progress — avoids single-global overwrite when multiple ScoreManagers coexist */
const _sseHandlers = new Map<number, (data: { record_id: number; stage: string; percent: number; message: string; thought?: string }) => void>();

export function notifyProgress(data: { record_id: number; stage: string; percent: number; message: string; thought?: string }) {
	_sseHandlers.get(data.record_id)?.(data);
}

export class ScoreManager {
	private recordId: number | null;
	private bus: MessageBus | null;
	private _score: ScoreData | null = null;
	private _progress: ScoringProgress = { phase: null, percentage: 0, message: "", score_thought: "", feedback_thought: "" };
	private _polling = false;
	private pollTimer: ReturnType<typeof setInterval> | null = null;
	private listeners: Array<() => void> = [];
	private _visibilityHandler: (() => void) | null = null;
	private _sseThought: string = "";
	private _abortController: AbortController | null = null;
	private _retryBackoffMs = 2000;
	private _lastRetryTime = 0;

	private _registeredHandler: ((data: { record_id: number; stage: string; percent: number; message: string; thought?: string }) => void) | null = null;

	constructor(recordId: number | null, bus?: MessageBus) {
		this.recordId = recordId;
		this.bus = bus ?? null;
		if (recordId) {
			this._registeredHandler = this.onProgress.bind(this);
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

	private notifyScoreReady(): void {
		if (!this.bus || !this._score) return;
		this.bus.emit("score:ready", this._score);
	}

	async end(): Promise<void> {
		if (!this.recordId) return;
		if (this._polling || this._progress.phase === "completed") return;
		this._polling = true;
		this._progress = { phase: "loading", percentage: 5, message: "正在结束训练..." };
		this.notify();
		try {
			await api.post(`/training/${this.recordId}/end`);
		} catch (e) {
			this._polling = false;
			this._progress = { phase: "failed", percentage: 0, message: "结束训练失败，请重试" };
			this.notify();
			throw e;
		}
		this._progress = { phase: "loading", percentage: 10, message: "评分已触发，等待后台处理..." };
		this.notify();
		this.startPolling();
	}

	private startPolling(): void {
		if (this.pollTimer || !this.recordId) return;
		this._polling = true;
		const POLL_INTERVAL = 1500;
		let retries = 0;
		const maxRetries = 200;

		const poll = async () => {
			if (!this._polling) return;
			if (document.hidden) {
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
				const controller = new AbortController();
				this._abortController = controller;
				const res = await api.get(`/training/${this.recordId}/scoring-status`, {
					signal: controller.signal,
				});
				this._abortController = null;
				if (!this._polling) return;
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
				// Use backend real progress if available — 轮询与 WS 推送共用防回退
				// 守卫，避免轮询把 WS 已推进的相位拉回（两通道同源于后端 tracker）。
				if (data.progress) {
					const p = data.progress as { phase?: string; percentage?: number; message?: string; thought?: string; score_thought?: string; feedback_thought?: string };
					const phase = (VALID_PHASES as readonly string[]).includes(p.phase ?? "")
						? (p.phase as ScorePhase)
						: null;
					if (!this._isRegressive(phase, p.percentage ?? 0)) {
						this._progress = {
							phase,
							percentage: p.percentage ?? 0,
							message: p.message ?? "",
							thought: p.thought || this._sseThought,
							score_thought: p.score_thought || this._progress.score_thought || "",
							feedback_thought: p.feedback_thought || this._progress.feedback_thought || "",
						};
					} else {
						// 回退的轮询响应 — 保留当前相位/百分比，仅合并 thought 字段
						this._progress = {
							...this._progress,
							thought: p.thought || this._sseThought,
							score_thought: p.score_thought || this._progress.score_thought || "",
							feedback_thought: p.feedback_thought || this._progress.feedback_thought || "",
						};
					}
				} else {
					this._applyFakeProgress(Math.min(95, 10 + retries * 1.5));
				}
				this.notify();
			} catch {
				if (retries >= maxRetries - 5) {
					this._progress = { phase: "failed", percentage: 0, message: "评分状态查询失败" };
					this.stopPolling();
					this.notify();
					return;
				}
				this._applyFakeProgress(Math.min(95, 10 + retries * 1.5));
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
		if (this._abortController) {
			this._abortController.abort();
			this._abortController = null;
		}
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
		this.listeners = [];
		this._score = null;
		this._progress = { phase: null, percentage: 0, message: "" };
		this._visibilityHandler = null;
		this._sseThought = "";
	}

	reset(): void {
		this.stopPolling();
		this._score = null;
		this._progress = { phase: null, percentage: 0, message: "", score_thought: "", feedback_thought: "" };
		this._sseThought = "";
		this._retryBackoffMs = 2000;
		this._lastRetryTime = 0;
		this.notify();
	}

	setRecordId(id: number | null): void {
		if (this.recordId) _sseHandlers.delete(this.recordId);
		this.recordId = id;
		this.reset();
		if (id) {
			this._registeredHandler = this.onProgress.bind(this);
			_sseHandlers.set(id, this._registeredHandler);
		}
	}

	/** 无后端进度时的假进度 — 若 WS 已推进到有效相位则不降级为 processing */
	private _applyFakeProgress(pct: number): void {
		const current = this._progress.phase;
		if (current && current !== "processing" && current !== "failed" && current !== "completed") {
			if (pct > this._progress.percentage) {
				this._progress = { ...this._progress, percentage: pct };
			}
			return;
		}
		this._progress = { phase: "processing", percentage: pct, message: "评分处理中..." };
	}

	/**
	 * 相位防回退守卫 — 拒绝乱序事件导致的 phase/percentage 倒退。
	 * "failed"/"processing" 不在顺序表内，始终接受（终态/兜底态）。
	 * scoring 与 feedback 在后端并行（asyncio.gather），事件可能交错乱序。
	 */
	private _isRegressive(phase: ScorePhase, percentage: number): boolean {
		if (!phase || phase === "failed" || phase === "processing") return false;
		const current = this._progress.phase;
		if (!current || current === "failed" || current === "processing") return false;
		const currentOrder = PHASE_ORDER[current] ?? -1;
		const newOrder = PHASE_ORDER[phase] ?? -1;
		if (newOrder < 0 || currentOrder < 0) return false;
		if (newOrder < currentOrder) return true;
		return newOrder === currentOrder && percentage < this._progress.percentage;
	}

	/** 重新触发评分（后端 retry-scoring 端点）并重启轮询。失败后 UI 一键重试使用。 */
	/** 重新触发评分（后端 retry-scoring 端点）并重启轮询。失败后 UI 一键重试使用。
	 *  内置指数退避：首次 2s，每次失败翻倍，最大 30s，成功后重置。 */
	async retry(): Promise<void> {
		if (!this.recordId) return;
		if (this._polling) return;

		// 指数退避冷却检查
		const now = Date.now();
		const elapsed = now - this._lastRetryTime;
		if (elapsed < this._retryBackoffMs) {
			throw new Error(`请等待 ${Math.ceil((this._retryBackoffMs - elapsed) / 1000)} 秒后重试`);
		}

		this.stopPolling();
		this._polling = true;
		this._score = null;
		this._progress = { phase: "loading", percentage: 5, message: "正在重新触发评分..." };
		this.notify();
		try {
			await retryScoring(this.recordId);
			this._retryBackoffMs = 2000; // 成功后重置退避
		} catch (e) {
			this._polling = false;
			this._lastRetryTime = Date.now();
			this._retryBackoffMs = Math.min(this._retryBackoffMs * 2, 30000);
			this._progress = { phase: "failed", percentage: 0, message: "重新触发评分失败，请稍后重试" };
			this.notify();
			throw e;
		}
		this._progress = { phase: "loading", percentage: 10, message: "评分已触发，等待后台处理..." };
		this.notify();
		this.startPolling();
	}

	/** Receive real-time SSE scoring progress (from useScoringNotifications hook) */
	onProgress(data: { record_id: number; stage: string; percent: number; message: string; thought?: string }): void {
		if (data.record_id !== this.recordId) return;
		if (data.thought) {
			this._sseThought = data.thought;
		}
		const phase = (VALID_PHASES as readonly string[]).includes(data.stage)
			? (data.stage as ScorePhase)
			: null;

		// Always update per-stage thought fields (even if phase/percentage is regressive).
		// Scoring and feedback run in parallel via asyncio.gather — either may finish first.
		// We must allow cross-phase thought updates so both panels show streaming content.
		const merged = { ...this._progress };
		if (data.stage === "scoring" && data.thought) {
			merged.score_thought = data.thought;
		}
		if (data.stage === "feedback" && data.thought) {
			merged.feedback_thought = data.thought;
		}

		if (!this._isRegressive(phase, data.percent)) {
			merged.phase = phase;
			merged.percentage = data.percent;
			merged.message = data.message;
			merged.thought = this._sseThought;
		}

		this._progress = merged as ScoringProgress;
		this.notify();
	}
}
