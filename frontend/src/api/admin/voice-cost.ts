import { api } from "../client";

// ── Voice Usage ──

export interface VoiceUsageItem {
	calls_total: number;
	calls_success: number;
	calls_fallback: number;
	calls_error: number;
	total_chars: number;
	total_latency_ms: number;
	cost_estimated: number;
}

export interface VoiceUsageResponse {
	tts_today: VoiceUsageItem;
	tts_month: VoiceUsageItem;
	monthly_budget: number;
	monthly_used: number;
}

// ── Cost Dashboard ──

export interface CostBreakdown {
	calls: number;
	success: number;
	error: number;
	latency_ms_avg: number;
	total_cost: number;
}

export interface CostSeriesPoint {
	date: string;
	llm_cost: number;
	tts_cost: number;
}

export interface CostDashboardResponse {
	today: CostBreakdown;
	this_month: CostBreakdown;
	llm_today: CostBreakdown;
	tts_today: CostBreakdown;
	monthly_budget: number;
	monthly_used: number;
	llm_monthly_budget: number;
	voice_monthly_budget: number;
	daily_series: CostSeriesPoint[];
	top_users: { user_name: string; total_cost: number; calls: number }[];
	/**
	 * 院校费用拆分（本月）。只有平台角色拿得到；院校管理员为空数组
	 * （自己的合计已在 today/this_month 里）。`school_id: null` = 未归属开销。
	 */
	by_school: SchoolCostItem[];
}

export interface SchoolCostItem {
	school_id: number | null;
	school_name: string;
	llm_cost: number;
	llm_calls: number;
	voice_cost: number;
	voice_calls: number;
	total_cost: number;
	calls: number;
}

// ── Cost Export ──

export interface CostExportParams {
	start_date?: string;
	end_date?: string;
	service?: string | null;
	granularity?: string;
	format?: string;
}

export interface CostExportRow {
	[key: string]: unknown;
	date: string;
	service: string;
	cost: number;
	calls: number;
	success: number;
	error: number;
}

export type CostExportResponse = CostExportRow[];

// ── API Functions ──

export const fetchVoiceUsage = () =>
	api.get<VoiceUsageResponse>("/admin/costs/usage");

export const fetchCostDashboard = () =>
	api.get<CostDashboardResponse>("/admin/costs/dashboard");

export const fetchCostExport = (params: CostExportParams) =>
	api.get<CostExportResponse>("/admin/costs/export", { params });

export const fetchUserCostBreakdown = () =>
	api.get<{ items: UserCostItem[] }>("/admin/costs/users");

export interface UserPurposeCost {
	calls: number;
	input_tokens: number;
	output_tokens: number;
	cost: number;
}

export interface UserCostItem {
	user_id: number;
	user_name: string;
	total_cost: number;
	total_calls: number;
	purposes: Record<string, UserPurposeCost>;
}
