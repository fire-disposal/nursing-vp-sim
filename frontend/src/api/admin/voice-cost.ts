import useAuthStore from "@/stores/authStore";
import { api } from "../client";

// ── Voice Config ──

export interface VoiceConfigResponse {
	id: number;
	provider: string;
	api_key_masked: string;
	api_key_suffix: string;
	tts_resource_id: string;
	tts_speaker: string;
	tts_model: string;
	tts_sample_rate: number;
	tts_format: string;
	tts_timeout: number;
	monthly_budget: number;
	is_active: boolean;
	speaker_library: Record<string, string> | null;
	created_at: string;
	updated_at: string;
}

export interface VoiceConfigUpdateRequest {
	provider?: string;
	api_key?: string | null;
	tts_resource_id?: string;
	tts_speaker?: string;
	tts_model?: string;
	tts_sample_rate?: number;
	tts_format?: string;
	tts_timeout?: number;
	monthly_budget?: number;
	is_active?: boolean;
	speaker_library?: Record<string, string> | null;
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
	api.get<VoiceUsageResponse>("/admin/costs/usage");

export interface VoiceStatusResponse {
	provider: string;
	tts_online: boolean;
	last_error: string | null;
	last_error_at: string | null;
	tts_pool_size: number | null;
	tts_pool_total: number | null;
	tts_pool_idle: number | null;
	tts_pool_in_use: number | null;
}

export const testTTS = () =>
	api.post<VoiceStatusResponse>("/admin/voice/config/test-tts");

/** Stream test audio through the production path (pool + PCM 24kHz). */
export const streamTestTTS = async (
	text: string,
	signal: AbortSignal,
): Promise<ReadableStream<Uint8Array>> => {
	const token = useAuthStore.getState().token;
	const response = await fetch("/api/admin/voice/config/test-stream", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			...(token ? { Authorization: `Bearer ${token}` } : {}),
		},
		body: JSON.stringify({ text }),
		signal,
	});
	if (!response.ok) {
		let detail = `HTTP ${response.status}`;
		try {
			const data = await response.json();
			if (data?.detail) detail = String(data.detail);
		} catch { /* keep default */ }
		throw new Error(detail);
	}
	if (!response.body) throw new Error("空响应体");
	return response.body;
};



export const fetchCostDashboard = () =>
	api.get<CostDashboardResponse>("/admin/costs/dashboard");

export const fetchCostExport = (params: CostExportParams) =>
	api.get<CostExportResponse>("/admin/costs/export", { params });

// ── Voice Config Import / Export ──

export interface VoiceConfigExportResponse {
	provider: string;
	tts_resource_id: string;
	tts_speaker: string;
	tts_model: string;
	tts_sample_rate: number;
	tts_format: string;
	tts_timeout: number;
	asr_resource_id: string;
	asr_sample_rate: number;
	asr_endpoint_mode: string;
	monthly_budget: number;
	exported_at: string;
}

export const exportVoiceConfig = () =>
	api.get<VoiceConfigExportResponse>("/admin/voice/config/export");

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

export interface VoiceSecretOption {
	id: number;
	label: string;
	key_suffix: string;
	status: string;
}

export const fetchVoiceSecretOptions = () =>
	api.get<VoiceSecretOption[]>("/admin/voice/secrets");
