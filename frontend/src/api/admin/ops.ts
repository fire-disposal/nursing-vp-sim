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
	/** 情境训练（正式特性）：24h 计数 + 即时会话状态。 */
	scenario?: {
		scope: "db";
		/** 计数字段的窗口（滚动 24h）。 */
		window: string;
		/** 会话状态计数（`active` / `completed`）的窗口：即时 `now`。 */
		state_window: string;
		/** 近 24h 开局的会话数。 */
		opened_24h: number;
		/** 进行中会话数（即时）。 */
		active: number;
		/** 已结束会话数（即时）。 */
		completed: number;
		/** 近 24h 的 DM 回合数。 */
		turns_24h: number;
		/** 近 24h DM 调用失败（供应商错误/解析/截断）的回合数。 */
		llm_failures_24h: number;
		/** 近 24h 走了无 LLM 保底回合的次数（设计内兜底，不是崩溃）。 */
		fallbacks_24h: number;
		/** 近 24h 入库的 DM 生成图片数。 */
		generated_images_24h: number;
		/** 近 24h 学生侧限流命中次数（审计 `scenario.rate_limited`）。 */
		rate_limited_24h: number;
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
