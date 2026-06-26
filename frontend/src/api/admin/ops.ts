import { api } from "@/api/client";

export interface DiagnoseResponse {
	version: string;
	health: { status: "ok" };
	summary: { status: "healthy" | "degraded" };
	llm: {
		total_calls_24h: number;
		success_rate: number;
		error_count_24h: number;
		avg_latency_ms: number;
		recent_errors: { type: string; count: number }[];
	};
	scoring: { pending: number; stuck: number; in_progress: number };
	voice: {
		tts: { calls_24h: number; success_rate: number; error_count_24h: number; avg_latency_ms: number; cost_24h: number };
		asr: { calls_24h: number; success_rate: number; error_count_24h: number; avg_latency_ms: number; cost_24h: number };
	};
	voice_budget: { monthly_budget: number; monthly_cost: number; usage_pct: number };
	metrics: {
		active_sessions: number;
		uptime_seconds: number;
		version: string;
	} & Record<string, unknown>;
	errors: {
		count: { last_5min: number; last_hour: number; total_captured: number };
		recent: { time: string; level: string; logger: string; message: string }[];
	};
	alerts: string[];
}

export const fetchDiagnose = () =>
	api.get<DiagnoseResponse>("/diagnose");
