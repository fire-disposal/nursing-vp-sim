import { api } from "@/api/client";


export interface FrontendErrorEntry {
	time: string;
	first_seen?: string;
	fingerprint?: string;
	type: string;
	message: string;
	url: string;
	user_id: number;
	count: number;
	source?: string;
	component_stack?: string;
	/** 出事端浏览器 UA（跨 worker 归档携带，用于区分机房旧浏览器等环境差异）。 */
	ua?: string;
}

export interface ErrorCount {
	last_5min: number;
	last_hour: number;
	/** 24h 内不同错误签名数（与 unique_24h 同义，历史键名）。 */
	total_captured: number;
	unique_24h: number;
}
export interface FrontendErrors {
	scope: "workers";
	window: string;
	window_by_count: Record<string, string>;
	count: ErrorCount;
	groups: FrontendErrorEntry[];
}

export interface RequestHotspot {
	route: string;
	status: number;
	count: number;
}

export interface RequestMetrics {
	total?: number;
	by_status?: Record<string, number>;
	by_status_code?: Record<string, number>;
	top_4xx?: RequestHotspot[];
	top_5xx?: RequestHotspot[];
	latency_ms?: { p50?: number; p95?: number; p99?: number; avg?: number };
}
export interface DiagnoseResponse {
	llm: {
		total_calls_24h: number;
		success_rate: number;
		error_count_24h: number;
		avg_latency_ms: number;
		recent_errors: { type: string; count: number }[];
	};
	scoring: {
		pending: number;
		in_progress: number;
		completed_24h: number;
		failed_24h: number;
		success_rate: number;
	};
	/** 持久化 Job 队列（`SCORING_EXECUTION=job` 时评分的执行路径）。 */
	jobs?: {
		scope: "db";
		window: string;
		/** kind → status → 计数（只出现库里存在过的组合）。 */
		by_kind: Record<string, Record<string, number>>;
		/** 最老 pending 作业已等待秒数；持续抬头=消费者跟不上。 */
		oldest_pending_seconds: number;
		/** running 且租约已过期（执行者消失、等待重领）的条数。 */
		expired_leases: number;
	};
	voice: {
		tts: { calls_24h: number; success_rate: number; error_count_24h: number; avg_latency_ms: number; cost_24h: number };
	};
	voice_budget: { monthly_budget: number; monthly_cost: number; usage_pct: number };
	business: { today_users: number; today_trainings: number; today_completed: number };
	/** 未回复反馈概览 —— 只含计数与最老一条的时间，不含正文/用户标识。 */
	feedback?: {
		scope: "db";
		window: string;
		unanswered: number;
		oldest_created_at: string | null;
		oldest_age_days: number | null;
	};
	metrics: Record<string, unknown> & { requests?: RequestMetrics; version?: string; active_sessions?: number; uptime_seconds?: number };
	errors: {
		scope: "workers";
		window_by_count: Record<string, string>;
		count: ErrorCount;
		recent: { time: string; level: string; logger: string; message: string }[];
	};
	frontend_errors?: FrontendErrors;
	alerts: string[];
}

export const fetchDiagnose = () =>
	api.get<DiagnoseResponse>("/admin/ops/dashboard");
