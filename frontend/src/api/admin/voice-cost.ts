import { api } from "../axios-instance";

// ── Voice Config ──

export interface VoiceConfigResponse {
	id: number;
	provider: string;
	app_id: string;
	token_masked: string;
	tts_voice_type: string;
	tts_timeout: number;
	asr_sample_rate: number;
	asr_enable_streaming: boolean;
	monthly_budget: number;
	is_active: boolean;
	created_at: string;
	updated_at: string;
}

export interface VoiceConfigUpdateRequest {
	provider?: string;
	app_id?: string;
	token?: string | null;
	tts_voice_type?: string;
	tts_timeout?: number;
	asr_sample_rate?: number;
	asr_enable_streaming?: boolean;
	monthly_budget?: number;
	is_active?: boolean;
}

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
	asr_today: VoiceUsageItem;
	tts_month: VoiceUsageItem;
	asr_month: VoiceUsageItem;
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
	asr_cost: number;
}

export interface CostDashboardResponse {
	today: CostBreakdown;
	this_month: CostBreakdown;
	llm_today: CostBreakdown;
	tts_today: CostBreakdown;
	asr_today: CostBreakdown;
	monthly_budget: number;
	monthly_used: number;
	llm_monthly_budget: number;
	voice_monthly_budget: number;
	daily_series: CostSeriesPoint[];
	top_users: { user_name: string; total_cost: number; calls: number }[];
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

export const fetchVoiceConfig = () =>
	api.get<VoiceConfigResponse>("/admin/voice/config");

export const updateVoiceConfig = (data: VoiceConfigUpdateRequest) =>
	api.put<VoiceConfigResponse>("/admin/voice/config", data);

export const fetchVoiceUsage = () =>
	api.get<VoiceUsageResponse>("/admin/voice/usage");

export interface VoiceStatusResponse {
	provider: string;
	tts_online: boolean;
	asr_online: boolean;
	last_error: string | null;
	last_error_at: string | null;
}

export const testTTS = () =>
	api.post<VoiceStatusResponse>("/admin/voice/config/test-tts");

export const testASR = () =>
	api.post<VoiceStatusResponse>("/admin/voice/config/test-asr");

export const fetchCostDashboard = () =>
	api.get<CostDashboardResponse>("/admin/voice/costs/dashboard");

export const fetchCostExport = (params: CostExportParams) =>
	api.get<CostExportResponse>("/admin/voice/costs/export", { params });

// ── Voice Config Import / Export ──

export interface VoiceConfigExportResponse {
	provider: string;
	app_id: string;
	tts_voice_type: string;
	tts_timeout: number;
	asr_sample_rate: number;
	asr_enable_streaming: boolean;
	monthly_budget: number;
	exported_at: string;
}

export interface VoiceConfigImportRequest {
	provider?: string;
	app_id: string;
	token: string;
	tts_voice_type?: string;
	tts_timeout?: number;
	asr_sample_rate?: number;
	asr_enable_streaming?: boolean;
	monthly_budget?: number;
}

export const exportVoiceConfig = () =>
	api.get<VoiceConfigExportResponse>("/admin/voice/config/export");

export const importVoiceConfig = (data: VoiceConfigImportRequest) =>
	api.post<VoiceConfigResponse>("/admin/voice/config/import", data);
