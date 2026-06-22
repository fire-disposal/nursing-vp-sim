import { api } from "@/api/axios-instance";

export interface OpsDashboard {
	health: { status: string; version: string };
	time: string;
	uptime_hours: number;
	llm: {
		total_calls_24h: number;
		success_rate: number;
		error_count_24h: number;
		avg_latency_ms: number;
		recent_errors: { type: string; count: number }[];
	};
	scoring: { pending: number; stuck: number };
	sessions: { active: number };
	notifications: { unread: number };
	system_errors: Record<string, number>;
}

export interface OpsErrorEntry {
	timestamp: string;
	logger: string;
	message: string;
	pathname: string;
	lineno: number;
}

export interface OpsErrors {
	count: { last_5min: number; last_hour: number; total_captured: number };
	recent: OpsErrorEntry[];
}

export interface OpsReport {
	summary: { time: string; uptime_hours: number; status: "healthy" | "degraded" };
	llm: {
		total_calls_24h: number;
		success_rate: number;
		error_count_24h: number;
		avg_latency_ms: number;
		top_errors: { type: string; count: number }[];
	};
	scoring: { pending: number; stuck: number };
	sessions: { active: number };
	notifications: { unread: number };
	alerts: string[];
}

export const fetchOpsDashboard = () =>
	api.get<OpsDashboard>("/admin/ops/dashboard");

export const fetchOpsErrors = (n = 20) =>
	api.get<OpsErrors>("/admin/ops/errors", { params: { n } });

export const fetchOpsReport = () =>
	api.get<OpsReport>("/admin/ops/report");
