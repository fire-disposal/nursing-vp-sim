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
	/** ASR 独立统计（按小时计费，与 TTS 的字符预算互不相干）。 */
	asr_today: VoiceUsageItem;
	asr_month: VoiceUsageItem;
	monthly_budget: number;
	/** 只含 TTS 的当月花费——预算口径是 TTS 字符预算，不含 ASR。 */
	monthly_used: number;
}

// ── ASR 配置（独立凭据） ──

export interface VoiceConfigResponse {
	id: number;
	provider: string;
	api_key_masked: string;
	api_key_suffix: string;
	/** ASR 独立 Key：响应里只有掩码与尾 4 位，完整 Key 不出后端。 */
	asr_api_key_masked: string;
	asr_api_key_suffix: string;
	tts_resource_id: string;
	tts_speaker: string;
	tts_model: string;
	tts_sample_rate: number;
	tts_format: string;
	tts_timeout: number;
	monthly_budget: number;
	is_active: boolean;
	speaker_library?: Record<string, string> | null;
	created_at: string;
	updated_at: string;
}

/** ``POST /admin/voice/config/test-asr``：只验证「连得上 + 配置帧被接受」，不发音频。 */
export interface AsrStatusResponse {
	provider: string;
	asr_online: boolean;
	last_error: string | null;
	last_error_at: string | null;
	resource_id: string;
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

export type VoiceConfigUpdatePayload = Partial<VoiceConfigResponse> & {
	api_key?: string | null;
	asr_api_key?: string | null;
};

/** 读语音配置（TTS + ASR 两个 Key 的掩码都在这里，只有一份）。 */
export const fetchVoiceConfig = () =>
	api.get<VoiceConfigResponse>("/admin/voice/config").then((r) => r.data);

/**
 * 写语音配置。后端 `VoiceConfigUpdateRequest` 里除 `api_key`/`asr_api_key` 外都有默认值，
 * PUT 会整份覆盖——所以这里只接受「要改的字段」，调用方各自只带自己那部分
 * （ASR 卡只发 `asr_api_key`，不得捎带 TTS 字段）。
 */
export const updateVoiceConfig = (payload: VoiceConfigUpdatePayload) =>
	api.put<VoiceConfigResponse>("/admin/voice/config", payload).then((r) => r.data);

/** ASR 连通性测试：只连接并发配置帧，不发送音频。 */
export const testAsrConnection = () =>
	api.post<AsrStatusResponse>("/admin/voice/config/test-asr").then((r) => r.data);

export const fetchVoiceUsage = () =>
	api.get<VoiceUsageResponse>("/admin/costs/usage");

export const fetchCostDashboard = () =>
	api.get<CostDashboardResponse>("/admin/costs/dashboard");

export const fetchCostExport = (params: CostExportParams) =>
	api.get<CostExportResponse>("/admin/costs/export", { params });

/** 下载成本明细：CSV/XLSX 由服务端统一导出器生成（BOM、转义、留痕都在那里）。 */
export const downloadCostExport = (params: CostExportParams, format: "csv" | "xlsx") =>
	api.get<Blob>("/admin/costs/export", {
		params: { ...params, format },
		responseType: "blob",
	});

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
