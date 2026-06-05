// 自动生成 — 来源 openapi.json
// 运行 npm run api:generate:miniapp 更新

export interface AdminStats {
  total_students: number
  total_records: number
  completed_records: number
  average_score: number | null
  avg_duration_min?: number | null
  today_records?: number
}

export interface ApiSecretCreate {
  label: string
  raw_key: string
  base_url?: string | null
  price_input_per_1m?: number
  price_output_per_1m?: number
  monthly_cost_limit?: number | null
}

export interface ApiSecretResponse {
  id: number
  label: string
  key_suffix: string
  base_url?: string
  provider?: string
  status?: string
  degraded_reason?: string | null
  degraded_until?: string | null
  price_input_per_1m?: number
  price_output_per_1m?: number
  monthly_cost_limit?: number | null
  call_count_today?: number
  total_tokens_today?: number
  total_cost_today?: number
  monthly_cost_used?: number
  config_count?: number
  last_used_at?: string | null
  created_at: string
  updated_at: string
}

export interface ApiSecretUpdate {
  label?: string | null
  base_url?: string | null
  price_input_per_1m?: number | null
  price_output_per_1m?: number | null
  monthly_cost_limit?: number | null
}

export interface BatchCreateResult {
  created: number
  skipped: number
  errors: string[]
}

export interface BatchUserItem {
  username: string
  password: string
  display_name: string
  role?: string
  student_id?: string | null
  class_id?: number | null
}

export interface CaseBrief {
  id: number
  name: string
  difficulty?: number
  description?: string | null
  patient_summary?: Record<string, unknown> | null
}

export interface CaseCreateRequest {
  case_data: Record<string, unknown>
}

export interface CaseDetail {
  id: number
  name: string
  description?: string | null
  case_data: Record<string, unknown>
}

export interface CaseGenerateRequest {
  mode?: string
  description: string
  reference_case_ids?: number[] | null
  reference_text?: string | null
  field?: string | null
  current_case_data?: Record<string, unknown> | null
}

export interface CaseGenerateResponse {
  case_data?: Record<string, unknown> | null
  field_value?: unknown | null
  field?: string | null
}

export interface CaseManageItem {
  id: number
  name: string
  description?: string | null
  patient_name?: string
  patient_age?: number | null
  patient_gender?: string
  chief_complaint?: string
  time_limit?: number
  difficulty?: number
  created_at: string
  training_count?: number
}

export interface CaseUpdateRequest {
  case_data: Record<string, unknown>
}

export interface CatalogResponse {
  providers?: ProviderPresetResponse[]
}

export interface ChangePasswordRequest {
  old_password: string
  new_password: string
}

export interface ChatMessageRequest {
  content: string
}

export interface ChatMessageResponse {
  role: string
  content: string
}

export interface ClassCreate {
  grade_id: number
  name: string
}

export interface ClassResponse {
  id: number
  grade_id: number
  grade_name?: string
  name: string
  student_count?: number
  created_at: string
}

export interface ClassSummaryItemSchema {
  class_id: number
  class_name: string
  grade_name: string
  student_count?: number
  avg_score?: number | null
  completion_rate?: number
  total_sessions?: number
  total_minutes?: number
}

export interface ClassUpdate {
  name?: string | null
  grade_id?: number | null
}

export interface ConfigCreateResponse {
  id: number
}

export interface DurationStats {
  daily: Record<string, unknown>[]
  total_minutes: number
  total_sessions: number
}

export interface FeedbackDailyItem {
  date: string
  rating_1?: number
  rating_2?: number
  rating_3?: number
  rating_4?: number
  rating_5?: number
}

export interface FeedbackItem {
  id: number
  user_id: number
  user_name?: string
  rating: number
  tag: string
  content?: string | null
  created_at: string
}

export interface FeedbackSubmit {
  rating: number
  tag: string
  content?: string | null
}

export interface FeedbackSubmitResponse {
  id: number
  created_at: string
}

export interface GradeCreate {
  name: string
}

export interface GradeResponse {
  id: number
  name: string
  class_count?: number
  student_count?: number
  created_at: string
}

export interface GradeUpdate {
  name: string
}

export interface HTTPValidationError {
  detail?: ValidationError[]
}

export interface HealthCheckItem {
  base_url: string
  status: string
  latency_ms?: number | null
  error?: string | null
}

export interface LLMCallLogItem {
  id: number
  user_id?: number | null
  record_id?: number | null
  case_id?: number | null
  purpose: string
  provider_name?: string
  model?: string
  temperature?: number | null
  max_tokens?: number | null
  prompt_tokens?: number | null
  completion_tokens?: number | null
  total_tokens?: number | null
  token_estimated?: number
  estimated_cost?: number | null
  cost_currency?: string | null
  latency_ms?: number | null
  status?: string
  error_type?: string | null
  error_message?: string | null
  request_chars?: number | null
  response_chars?: number | null
  request_text?: string | null
  response_text?: string | null
  created_at: string
  call_count?: number
  avg_latency_ms?: number | null
  error_count?: number
  first_called_at?: string | null
  last_called_at?: string | null
  student_name?: string | null
  case_name?: string | null
  is_aggregated?: boolean
}

export interface LLMConfigCreate {
  secret_id: number
  model: string
  purpose: string
  label?: string
  priority?: number
  weight?: number
  price_input_per_1m?: number
  price_output_per_1m?: number
  monthly_cost_limit?: number | null
}

export interface LLMConfigResponse {
  id: number
  secret_id: number
  secret_label?: string
  secret_suffix?: string
  base_url?: string
  provider?: string
  label?: string
  model: string
  purpose: string
  priority?: number
  weight?: number
  status?: string
  price_input_per_1m?: number
  price_output_per_1m?: number
  monthly_cost_limit?: number | null
  created_at: string
  updated_at: string
}

export interface LLMConfigUpdate {
  secret_id?: number | null
  model?: string | null
  purpose?: string | null
  label?: string | null
  priority?: number | null
  weight?: number | null
  price_input_per_1m?: number | null
  price_output_per_1m?: number | null
  monthly_cost_limit?: number | null
  status?: string | null
}

export interface LLMStatsResponse {
  today: Record<string, unknown>
  week: Record<string, unknown>
  month?: Record<string, unknown>
  by_purpose: Record<string, unknown>[]
  by_provider?: Record<string, unknown>[]
  daily: Record<string, unknown>[]
}

export interface LoginRequest {
  username: string
  password: string
}

export interface MessageItem {
  id: number
  role: string
  content: string
  created_at: string
}

export interface MessageResponse {
  message: string
}

export interface ModelPresetItem {
  name: string
  price_input?: number
  price_output?: number
}

export interface NoteCreateRequest {
  content: string
}

export interface NoteItem {
  id: number
  content: string
  created_at: string
  updated_at: string
}

export interface OkResponse {
  ok?: boolean
}

export interface PaginatedResponse_CaseBrief_ {
  items: CaseBrief[]
  total: number
  offset: number
  limit: number
}

export interface PaginatedResponse_CaseManageItem_ {
  items: CaseManageItem[]
  total: number
  offset: number
  limit: number
}

export interface PaginatedResponse_FeedbackItem_ {
  items: FeedbackItem[]
  total: number
  offset: number
  limit: number
}

export interface PaginatedResponse_LLMCallLogItem_ {
  items: LLMCallLogItem[]
  total: number
  offset: number
  limit: number
}

export interface PaginatedResponse_QASessionAdminItem_ {
  items: QASessionAdminItem[]
  total: number
  offset: number
  limit: number
}

export interface PaginatedResponse_RankingItem_ {
  items: RankingItem[]
  total: number
  offset: number
  limit: number
}

export interface PaginatedResponse_SchoolResponse_ {
  items: SchoolResponse[]
  total: number
  offset: number
  limit: number
}

export interface PaginatedResponse_TeacherSummaryItem_ {
  items: TeacherSummaryItem[]
  total: number
  offset: number
  limit: number
}

export interface PaginatedResponse_TrainingRecordBrief_ {
  items: TrainingRecordBrief[]
  total: number
  offset: number
  limit: number
}

export interface PaginatedResponse_UserBrief_ {
  items: UserBrief[]
  total: number
  offset: number
  limit: number
}

export interface PromptPreviewResponse {
  purpose: string
  version: number
  system_prompt_raw: string
  user_prompt_raw: string | null
  system_prompt_rendered: string
  user_prompt_rendered: string | null
  sample_vars: Record<string, unknown>
  render_error?: string | null
}

export interface PromptTemplateCreate {
  purpose: string
  name?: string | null
  system_prompt: string
  user_prompt?: string | null
  variables?: Record<string, unknown>[] | null
  created_by?: string | null
  remark?: string | null
  activate?: boolean
}

export interface PromptTemplateResponse {
  id: number
  purpose: string
  version: number
  name: string | null
  system_prompt: string
  user_prompt: string | null
  template_engine: string
  variables: Record<string, unknown>[] | null
  is_active: boolean
  created_by: string | null
  remark: string | null
  created_at: string
  updated_at: string
  is_builtin?: boolean
  locked?: boolean
}

export interface PromptTemplateUpdate {
  name?: string | null
  system_prompt?: string | null
  user_prompt?: string | null
  variables?: Record<string, unknown>[] | null
  remark?: string | null
}

export interface PromptValidateRequest {
  purpose: string
  system_prompt: string
  user_prompt?: string | null
  variables?: Record<string, unknown>[] | null
}

export interface PromptValidateResponse {
  valid: boolean
  errors?: string[]
  missing_vars?: string[]
  warnings?: string[]
}

export interface ProviderPresetResponse {
  provider?: string
  display_name?: string
  base_url?: string
  models?: ModelPresetItem[]
}

export interface QAAskResponse {
  session_id: number
  answer: string
}

export interface QAMessageItem {
  id: number
  role: string
  content: string
  created_at: string
}

export interface QASessionAdminItem {
  id: number
  user_id: number
  student_name?: string
  student_code?: string
  title: string
  message_count?: number
  created_at: string
  updated_at: string
}

export interface QASessionCreate {
  question: string
}

export interface QASessionItem {
  id: number
  title: string
  created_at: string
  updated_at: string
}

export interface RankingItem {
  user_id: number
  display_name: string
  student_id?: string | null
  total_sessions?: number
  avg_score?: number | null
  total_score?: number
  total_minutes?: number
  rank?: number
}

export interface RegisterRequest {
  username: string
  password: string
  role?: string
  display_name: string
  student_id?: string | null
  class_id?: number | null
}

export interface RoleCreateRequest {
  name: string
  display_name: string
  permissions?: string[]
}

export interface RoleResponse {
  id: number
  name: string
  display_name: string
  is_system?: boolean
  school_id?: number | null
  permissions?: string[]
  user_count?: number
}

export interface RoleUpdateRequest {
  display_name?: string | null
  permissions?: string[] | null
}

export interface RubricResponse {
  id: number
  name: string
  version?: string
  description?: string | null
  total_max?: number
  raw_max?: number
  raw_scale?: number
  dimensions?: Record<string, unknown>[]
  is_active?: boolean
  created_at: string
  updated_at: string
}

export interface SampleVarsResponse {
  purpose: string
  vars: Record<string, unknown>
}

export interface SchoolCreate {
  name: string
  admin_username: string
  admin_password: string
  admin_display_name: string
}

export interface SchoolResponse {
  id: number
  name: string
  teacher_count?: number
  student_count?: number
  created_at: string
}

export interface ScoreItem {
  id: number
  total_score: number
  detail_scores?: Record<string, unknown> | null
  strengths?: string[] | null
  weaknesses?: string[] | null
  missed_content?: string[] | null
  suggestions?: string | null
  rubric_version?: string | null
  model_name?: string | null
  prompt_version?: number | null
  score_scale?: number | null
  review_status?: string | null
  reviewed_by_name?: string | null
  reviewed_at?: string | null
  review_comment?: string | null
  created_at: string
}

export interface ScoreReviewRequest {
  detail_scores?: Record<string, unknown> | null
  comment?: string | null
}

export interface ScoreReviewResponse {
  score_id: number
  review_status: string
  reviewed_by_name?: string | null
  reviewed_at?: string | null
  original_detail_scores?: Record<string, unknown> | null
  review_detail_scores?: Record<string, unknown> | null
  review_comment?: string | null
}

export interface ScoringTriggerResponse {
  message: string
  record_id: number
  scoring_status: string
}

export interface SecretCreateResponse {
  id: number
  key_suffix: string
}

export interface StudentDetail {
  id: number
  username: string
  role: string
  display_name: string
  student_id: string | null
  created_at: string
  total_sessions?: number
  total_minutes?: number
  avg_score?: number | null
  recent_records?: unknown[]
  daily?: unknown[]
}

export interface TeacherSummaryItem {
  user_id: number
  display_name: string
  student_code?: string | null
  total_sessions?: number
  total_minutes?: number
}

export interface TestAllResultsResponse {
  results: TestResultItem[]
}

export interface TestResultItem {
  base_url: string
  ok: boolean
  status_code?: number | null
  latency_ms?: number | null
  error?: string | null
}

export interface ToggleStatusResponse {
  ok?: boolean
  status: string
}

export interface TokenResponse {
  access_token: string
  token_type?: string
  role: string
  display_name: string
  user_id: number
  school_id?: number | null
  school_name?: string | null
  permissions?: string[]
}

export interface TrainingRecordBrief {
  id: number
  case_id: number
  case_name: string
  user_display_name: string
  user_student_id: string | null
  status: string
  scoring_status?: string | null
  scoring_error?: string | null
  start_time: string
  end_time: string | null
  score_total?: number | null
}

export interface TrainingRecordDetail {
  id: number
  case_id: number
  case_name: string
  user_display_name: string
  status: string
  scoring_status?: string | null
  scoring_error?: string | null
  start_time: string
  end_time: string | null
  time_limit?: number
  remaining_seconds?: number | null
  messages: MessageItem[]
  score?: ScoreItem | null
  notes?: NoteItem[]
  required_inquiries?: unknown[] | null
  patient_info?: Record<string, unknown> | null
}

export interface TrainingStartRequest {
  case_id: number
}

export interface TrainingStartResponse {
  record_id: number
  greeting: string
  case_name?: string
}

export interface TrendStats {
  daily: Record<string, unknown>[]
  total_sessions: number
  total_minutes: number
  avg_score?: number | null
}

export interface UserBrief {
  id: number
  username: string
  role: string
  role_display_name: string
  display_name: string
  student_id: string | null
  class_id?: number | null
  class_name?: string | null
  grade_name?: string | null
  created_at: string
}

export interface UserUpdateRequest {
  display_name?: string | null
  student_id?: string | null
  class_id?: number | null
  role?: string | null
  password?: string | null
}

export interface ValidationError {
  loc: string | number[]
  msg: string
  type: string
  input?: unknown
  ctx?: Record<string, unknown>
}

export interface WechatBindRequest {
  code: string
}

export interface WechatLoginRequest {
  code: string
}

export interface WechatLoginResponse {
  access_token?: string | null
  token_type?: string
  role?: string | null
  display_name?: string | null
  user_id?: number | null
  school_id?: number | null
  school_name?: string | null
  permissions?: string[]
  need_bind?: boolean
}

export interface WechatRegisterRequest {
  code: string
  display_name: string
}

// ── API 函数 ──
import { get, post, request } from "./client"

export function login(data: LoginRequest): Promise<TokenResponse> {
  return post<TokenResponse>(`/api/auth/login`, data as unknown as Record<string, unknown>)
}

export function getMe(): Promise<UserBrief> {
  return get<UserBrief>("GET", `/api/auth/me`)
}

export function wechatLogin(data: WechatLoginRequest): Promise<WechatLoginResponse> {
  return post<WechatLoginResponse>(`/api/auth/wechat/login`, data as unknown as Record<string, unknown>)
}

export function wechatBind(data: WechatBindRequest): Promise<OkResponse> {
  return post<OkResponse>(`/api/auth/wechat/bind`, data as unknown as Record<string, unknown>)
}

export function getCases(params?: { offset?: number; limit?: number }): Promise<PaginatedResponse_CaseBrief_> {
  return get<PaginatedResponse_CaseBrief_>(`/api/cases`, params as Record<string, string | number | undefined>)
}

export function startTraining(data: TrainingStartRequest): Promise<TrainingStartResponse> {
  return post<TrainingStartResponse>(`/api/training/start`, data as unknown as Record<string, unknown>)
}

export function endTraining(recordId: number): Promise<unknown> {
  return get<unknown>("POST", `/api/training/${record_id}/end`)
}

export function getRecords(params?: { offset?: number; limit?: number; status?: string }): Promise<PaginatedResponse_TrainingRecordBrief_> {
  return get<PaginatedResponse_TrainingRecordBrief_>(`/api/training/records`, params as Record<string, string | number | undefined>)
}

export function getRecordDetail(recordId: number): Promise<TrainingRecordDetail> {
  return get<TrainingRecordDetail>("GET", `/api/training/records/${record_id}`)
}

export function sendMessage(recordId: number, data: ChatMessageRequest): Promise<ChatMessageResponse> {
  return post<ChatMessageResponse>(`/api/chat/${record_id}/message`, data as unknown as Record<string, unknown>)
}

export function getDurationStats(params?: { period?: string }): Promise<DurationStats> {
  return get<DurationStats>(`/api/stats/duration`, params as Record<string, string | number | undefined>)
}

export function getTrends(params?: { period?: string }): Promise<TrendStats> {
  return get<TrendStats>(`/api/stats/trends`, params as Record<string, string | number | undefined>)
}

