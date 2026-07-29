import { api } from "@/api/client";


export interface FrontendErrorEntry {
	time: string;
	type: string;
	message: string;
	url: string;
	user_id: number;
	count: number;
	source?: string;
	component_stack?: string;
}

export interface FrontendErrors {
	last_5min: number;
	last_hour: number;
	total_captured: number;
	recent: FrontendErrorEntry[];
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
	health: { status: string; version?: string };
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
	voice: {
		tts: { calls_24h: number; success_rate: number; error_count_24h: number; avg_latency_ms: number; cost_24h: number };
	};
	voice_budget: { monthly_budget: number; monthly_cost: number; usage_pct: number };
	metrics: Record<string, unknown> & { requests?: RequestMetrics };
	errors: {
		count: { last_5min: number; last_hour: number; total_captured: number; unique_24h?: number };
		recent: { time: string; level: string; logger: string; message: string }[];
	};
	frontend_errors?: FrontendErrors;
	alerts: string[];
}

export const fetchDiagnose = () =>
	api.get<DiagnoseResponse>("/admin/ops/dashboard");
