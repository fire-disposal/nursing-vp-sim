import { api } from "@/api/client";

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
	metrics: Record<string, unknown>;
	errors: {
		count: { last_5min: number; last_hour: number; total_captured: number; unique_24h?: number };
		recent: { time: string; level: string; logger: string; message: string }[];
	};
	alerts: string[];
}

export const fetchDiagnose = () =>
	api.get<DiagnoseResponse>("/admin/ops/dashboard");
