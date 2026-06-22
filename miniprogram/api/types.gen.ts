// 自动生成 — 来源 openapi.json
// 运行 npm run api:generate:miniapp 更新

export interface ASRRecognizeRequest {
  audio: string
  record_id?: number | null
  format?: string
  sample_rate?: number
}

export interface ASRRecognizeResponse {
  text: string
  confidence: number
}

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

export interface AssignmentCreateRequest {
  practice_id: number
  class_id: number
  title: string
  description?: string | null
  start_time: string
  end_time: string
}

export interface AssignmentDetail {
  id: string
  title: string
  description?: string | null
  practice_id: number
  practice_name?: string
  class_id: number
  class_name?: string
  start_time: string
  end_time: string
  created_at: string
  updated_at: string
  student_count?: number
  completed_count?: number
  scored_count?: number
  students?: AssignmentStudentItem[]
}

export interface AssignmentListItem {
  id: string
  title: string
  practice_name?: string
  class_name?: string
  start_time: string
  end_time: string
  student_count?: number
  completed_count?: number
  created_at: string
}

export interface AssignmentStudentItem {
  user_id: number
  display_name: string
  student_id?: string | null
  record_id?: number | null
  status?: string
  score_total?: number | null
  scoring_status?: string | null
  start_time?: string | null
  end_time?: string | null
  is_overdue?: boolean
}

export interface AssignmentUpdateRequest {
  practice_id?: number | null
  class_id?: number | null
  title?: string | null
  description?: string | null
  start_time?: string | null
  end_time?: string | null
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

export interface CaseAssignmentRequest {
  case_ids: number[]
  is_required?: boolean
  trigger_event?: string
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
  patient_personality?: string
  created_at: string
  training_count?: number
}

export interface CaseUpdateRequest {
  case_data: Record<string, unknown>
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
  operation?: Record<string, unknown> | null
}

export interface Citation {
  source: string
  section: string
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

export interface CostBreakdown {
  calls: number
  success: number
  error: number
  latency_ms_avg: number
  total_cost: number
}

export interface CostDashboardResponse {
  today: CostBreakdown
  this_month: CostBreakdown
  llm_today: CostBreakdown
  tts_today: CostBreakdown
  asr_today: CostBreakdown
  monthly_budget: number
  monthly_used: number
  llm_monthly_budget: number
  voice_monthly_budget: number
  daily_series: CostSeriesPoint[]
  top_users: Record<string, unknown>[]
}

export interface CostSeriesPoint {
  date: string
  llm_cost: number
  tts_cost: number
  asr_cost: number
}

export interface DBMetrics {
  pool_size: number
  checked_out: number
  overflow?: number
  connections_in_use: number
}

export interface DeleteResponse {
  ok?: boolean
  message?: string
}

export interface DurationStats {
  daily: Record<string, unknown>[]
  total_minutes: number
  total_sessions: number
}

export interface EmotionHistoryEntry {
  trust: number
  comfort: number
  state: string
  intent: string
  timestamp: string
}

export interface EmotionHistoryResponse {
  history: EmotionHistoryEntry[]
}

export interface EmotionStateResponse {
  trust: number
  comfort: number
  state: string
  note: string
  history?: Record<string, unknown>[]
}

export interface ExamOperationResponse {
  type: string
  data: ExamOperationResult
  all_results?: ExamOperationResult[]
}

export interface ExamOperationResult {
  type: string
  label?: string
  value?: string
  unit?: string
}

export interface FallbackStateResponse {
  available: boolean
  label: string
  key_suffix: string
  base_url: string
  model_flash: string
  model_pro: string
  latency_ms?: number | null
  error?: string | null
  call_count?: number
  total_tokens?: number
  total_cost?: number
}

export interface FeatureConfigResponse {
  id?: string | null
  features?: Record<string, unknown>
}

export interface FeaturesResponse {
  ok?: boolean
  message?: string | null
  features: Record<string, unknown>
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

export interface HealthResponse {
  status?: string
  version: string
}

export interface InitiativeHistoryResponse {
  history: InitiativeMessageEntry[]
}

export interface InitiativeMessageEntry {
  id: number
  content: string
  created_at: string
}

export interface InitiativeStateResponse {
  elapsed_seconds: number
  threshold_seconds: number
  percent: number
  should_trigger?: boolean
}

export interface InitiativeTriggerResponse {
  triggered: boolean
  message?: string | null
  id?: number | null
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
  purpose: string
  label?: string
}

export interface LLMConfigResponse {
  id: number
  secret_id: number
  secret_label?: string
  secret_suffix?: string
  base_url?: string
  label?: string
  purpose: string
  status?: string
  created_at: string
  updated_at: string
}

export interface LLMConfigUpdate {
  secret_id?: number | null
  purpose?: string | null
  label?: string | null
  status?: string | null
}

export interface LLMMetrics {
  calls_total: number
  calls_success: number
  calls_error: number
  tokens_used: number
  estimated_cost: number
  latency_ms: LatencyStats
  degraded_providers: number
  global_degraded: boolean
}

export interface LLMStatsResponse {
  today: Record<string, unknown>
  week: Record<string, unknown>
  month?: Record<string, unknown>
  by_purpose: Record<string, unknown>[]
  by_provider?: Record<string, unknown>[]
  daily: Record<string, unknown>[]
}

export interface LatencyStats {
  p50: number
  p95: number
  p99: number
  avg: number
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

export interface MetricBuckets {
  2xx?: number
  4xx?: number
  5xx?: number
}

export interface MetricsResponse {
  uptime_seconds: number
  version: string
  requests: RequestMetrics
  active_sessions: number
  llm: LLMMetrics
  db: DBMetrics
  queue: QueueMetrics
  memory_mb?: number
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

export interface NursingRecordResponse {
  id: number
  record_id: number
  sheet_data: Record<string, unknown>
  status: string
  updated_at: string
}

export interface NursingRecordSave {
  sheet_data?: Record<string, unknown>
  status?: string
}

export interface OkResponse {
  ok?: boolean
  message?: string | null
}

export interface PaginatedResponse_AssignmentListItem_ {
  items: AssignmentListItem[]
  total: number
  offset: number
  limit: number
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

export interface PaginatedResponse_PracticeItem_ {
  items: PracticeItem[]
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

export interface PaginatedResponse_QuestionnaireResponseItem_ {
  items: QuestionnaireResponseItem[]
  total: number
  offset: number
  limit: number
}

export interface PaginatedResponse_QuestionnaireTemplateResponse_ {
  items: QuestionnaireTemplateResponse[]
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

export interface PhaseAdvanceResponse {
  current_phase: string
  name: string
  order: number
}

export interface PracticeBrief {
  id: number
  name: string
  features?: Record<string, unknown>
  behavior?: Record<string, unknown>
}

export interface PracticeCreate {
  name: string
  description?: string | null
  case_id: number
  features?: Record<string, unknown>
  behavior?: Record<string, unknown>
}

export interface PracticeItem {
  id: number
  name: string
  description?: string | null
  case_id: number
  case_name?: string
  features?: Record<string, unknown>
  behavior?: Record<string, unknown>
  is_active?: boolean
  training_count?: number
  created_at: string
  updated_at: string
}

export interface PracticeUpdate {
  name?: string | null
  description?: string | null
  case_id?: number | null
  features?: Record<string, unknown> | null
  behavior?: Record<string, unknown> | null
  is_active?: boolean | null
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

export interface QAAskResponse {
  session_id: number
  answer: string
  citations?: Citation[] | null
}

export interface QAMessageItem {
  id: number
  role: string
  content: string
  created_at: string
  citations?: Citation[] | null
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
  rag_enabled?: boolean
}

export interface QASessionItem {
  id: number
  title: string
  created_at: string
  updated_at: string
}

export interface QuestionStatsItem {
  question_id: number
  content?: string
  question_type?: string
  response_count?: number
  avg_likert?: number | null
  choice_distribution?: Record<string, unknown>
  text_answers?: string[]
}

export interface QuestionnaireAnswerItem {
  question_id: number
  question_content?: string
  question_type?: string
  options?: string[] | null
  answer_value?: string | null
}

export interface QuestionnaireAnswerSubmit {
  question_id: number
  answer_value?: string | null
}

export interface QuestionnaireCheckResponse {
  has_pending: boolean
  template_id?: number | null
  response_id?: number | null
  template?: QuestionnaireTemplateDetailResponse | null
  is_required?: boolean
  trigger_event?: string
}

export interface QuestionnaireQuestionCreate {
  content: string
  question_type: string
  required?: boolean
  sort_order?: number
  options?: string[] | null
}

export interface QuestionnaireQuestionResponse {
  id: number
  template_id: number
  content: string
  question_type: string
  required: boolean
  sort_order: number
  options?: string[] | null
}

export interface QuestionnaireQuestionUpdate {
  content?: string | null
  question_type?: string | null
  required?: boolean | null
  sort_order?: number | null
  options?: string[] | null
}

export interface QuestionnaireResponseItem {
  id: number
  template_id: number
  template_title?: string
  user_id: number
  user_name?: string
  case_id?: number | null
  record_id?: number | null
  status: string
  answers?: QuestionnaireAnswerItem[]
  completed_at?: string | null
  created_at: string
}

export interface QuestionnaireStatsResponse {
  template_id: number
  template_title?: string
  total_assigned?: number
  total_completed?: number
  completion_rate?: number
  questions?: QuestionStatsItem[]
}

export interface QuestionnaireSubmitRequest {
  template_id: number
  case_id?: number | null
  record_id?: number | null
  answers: QuestionnaireAnswerSubmit[]
}

export interface QuestionnaireTemplateCreate {
  title: string
  type: string
  description?: string | null
  is_active?: boolean
  questions?: QuestionnaireQuestionCreate[]
}

export interface QuestionnaireTemplateDetailResponse {
  id: number
  title: string
  type: string
  description?: string | null
  is_active: boolean
  question_count?: number
  response_count?: number
  school_id?: number | null
  created_at: string
  updated_at: string
  questions?: QuestionnaireQuestionResponse[]
  case_ids?: number[]
}

export interface QuestionnaireTemplateResponse {
  id: number
  title: string
  type: string
  description?: string | null
  is_active: boolean
  question_count?: number
  response_count?: number
  school_id?: number | null
  created_at: string
  updated_at: string
}

export interface QuestionnaireTemplateUpdate {
  title?: string | null
  type?: string | null
  description?: string | null
  is_active?: boolean | null
}

export interface QueueMetrics {
  task_queue: number
  log_queue: number
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
  gender?: string | null
}

export interface RegisterResponse {
  id: number
  username: string
  role: string
  display_name: string
  student_id?: string | null
}

export interface RequestMetrics {
  total: number
  by_status: MetricBuckets
  latency_ms: LatencyStats
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

export interface RubricCreateRequest {
  name: string
  dimensions?: Record<string, unknown>[]
  version?: string
  description?: string | null
  total_max?: number
  raw_max?: number
  raw_scale?: number
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

export interface ScoringStatusResponse {
  scoring_status?: string | null
  scoring_error?: string | null
  score?: Record<string, unknown> | null
  progress?: Record<string, unknown> | null
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

export interface SectionTextResponse {
  source: string
  section: string
  text: string
}

export interface StudentAssignmentItem {
  id: string
  title: string
  practice_name: string
  start_time: string
  end_time: string
  status?: string
  record_id?: number | null
  score_total?: number | null
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

export interface SystemConfigItem {
  key: string
  value?: string | null
  description?: string | null
}

export interface SystemNotificationCreateRequest {
  title: string
  content: string
  level?: string
  is_active?: boolean
  published_at?: string | null
}

export interface SystemNotificationResponse {
  id: number
  title: string
  content: string
  level: string
  is_active: boolean
  created_by?: number | null
  published_at?: string | null
  created_at: string
  updated_at: string
}

export interface SystemNotificationUpdateRequest {
  title?: string | null
  content?: string | null
  level?: string | null
  is_active?: boolean | null
  published_at?: string | null
}

export interface TTSSynthesizeRequest {
  text: string
  record_id: number
  voice_type?: string | null
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
  gender?: string | null
  avatar?: string | null
}

export interface TrainingNotificationItem {
  id: number
  type: string
  title: string
  body?: string | null
  record_id?: number | null
  created_at: string
}

export interface TrainingRecordBrief {
  id: number
  case_id: number
  case_name: string
  user_display_name: string
  user_student_id: string | null
  status: string
  current_phase?: string | null
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
  current_phase?: string | null
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
  patient_gender?: string
  features?: Record<string, unknown>
  from_assignment?: boolean
  exam_anchors?: Record<string, unknown>
  exam_results?: Record<string, unknown>[]
}

export interface TrainingStartRequest {
  case_id: number
  practice_id?: number | null
  features?: Record<string, unknown> | null
  time_limit_minutes?: number | null
}

export interface TrainingStartResponse {
  record_id: number
  greeting: string
  case_name?: string
}

export interface TrainingStateResponse {
  record_id: number
  case_id: number
  emotion: EmotionStateResponse
  personality?: Record<string, unknown>
  deep_background_keys?: string[]
  exam_anchors?: Record<string, unknown>
  config: FeatureConfigResponse
  initiative: InitiativeStateResponse
  current_phase?: string
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
  gender?: string | null
  avatar?: string | null
  class_id?: number | null
  class_name?: string | null
  grade_name?: string | null
  created_at: string
}

export interface UserProfileUpdateRequest {
  display_name?: string | null
  student_id?: string | null
  gender?: string | null
  avatar?: string | null
}

export interface UserUpdateRequest {
  display_name?: string | null
  student_id?: string | null
  class_id?: number | null
  role?: string | null
  password?: string | null
  gender?: string | null
  avatar?: string | null
}

export interface ValidationError {
  loc: string | number[]
  msg: string
  type: string
  input?: unknown
  ctx?: Record<string, unknown>
}

export interface VoiceConfigImportRequest {
  provider?: string
  app_id: string
  token: string
  tts_voice_type?: string
  tts_timeout?: number
  asr_sample_rate?: number
  asr_enable_streaming?: boolean
  monthly_budget?: number
}

export interface VoiceConfigResponse {
  id: number
  provider: string
  app_id: string
  token_masked: string
  token_suffix: string
  tts_voice_type: string
  tts_timeout: number
  asr_sample_rate: number
  asr_enable_streaming: boolean
  monthly_budget: number
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface VoiceConfigUpdateRequest {
  provider?: string
  app_id: string
  token?: string | null
  tts_voice_type?: string
  tts_timeout?: number
  asr_sample_rate?: number
  asr_enable_streaming?: boolean
  monthly_budget?: number
  is_active?: boolean
}

export interface VoiceStatusResponse {
  provider: string
  tts_online: boolean
  asr_online: boolean
  last_error: string | null
  last_error_at: string | null
}

export interface VoiceUsageItem {
  calls_total: number
  calls_success: number
  calls_fallback: number
  calls_error: number
  total_chars: number
  total_latency_ms: number
  cost_estimated: number
}

export interface VoiceUsageResponse {
  tts_today: VoiceUsageItem
  asr_today: VoiceUsageItem
  tts_month: VoiceUsageItem
  asr_month: VoiceUsageItem
  monthly_budget: number
  monthly_used: number
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

