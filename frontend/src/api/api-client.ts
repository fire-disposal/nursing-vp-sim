import type { components } from "./api-types.gen";
import { api } from "./axios-instance";

type Schemas = components["schemas"];

// Auth
export const login = (username: string, password: string) => api.post<Schemas["TokenResponse"]>("/auth/login", { username, password });

export const register = (data: Schemas["RegisterRequest"]) => api.post<Schemas["TokenResponse"]>("/auth/register", data);

export const getMe = () => api.get<Schemas["UserBrief"]>("/auth/me");

export const refreshToken = () => api.post<Schemas["TokenResponse"]>("/auth/refresh");

export const changePassword = (oldPassword: string, newPassword: string) =>
  api.put<Schemas["OkResponse"]>("/auth/change-password", { old_password: oldPassword, new_password: newPassword });

// Cases
export const getCases = (params: Record<string, unknown> = {}) => api.get<Schemas["PaginatedResponse_CaseBrief_"]>("/cases", { params });

export const getCaseDetail = (id: number | string) => api.get<Schemas["CaseDetail"]>(`/cases/${id}`);

export const startTraining = (caseId: number | string, configId?: string) =>
  api.post<Schemas["TrainingStartResponse"]>("/training/start", { case_id: caseId, config_id: configId });

// Chat
export const sendMessage = (recordId: number | string, content: string, signal?: AbortSignal) =>
  api.post<Schemas["ChatMessageResponse"]>(`/chat/${recordId}/message`, { content }, { signal });

export async function sendMessageStream(
  recordId: number | string,
  content: string,
  onChunk: (text: string) => void,
  onDone: (id?: number) => void,
  onError: (msg: string) => void,
  onSanitized?: (reply: string) => void,
  onSystem?: (text: string) => void,
  signal?: AbortSignal,
) {
  const token = localStorage.getItem("token");
  const resp = await fetch(`/api/chat/${recordId}/message/stream`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ content }),
    signal,
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ detail: "请求失败" }));
    onError(err.detail || "请求失败");
    return;
  }

  if (!resp.body) {
    onError("响应体为空");
    return;
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      try {
        const data = JSON.parse(line.slice(6));
        if (data.error) {
          onError(data.error);
          return;
        }
        if (data.sanitized) {
          onSanitized?.(data.reply);
          continue;
        }
        if (data.system) {
          onSystem?.(data.system);
          continue;
        }
        if (data.done) {
          onDone(data.id);
          return;
        }
        if (data.content) {
          onChunk(data.content);
        }
      } catch {
        /* ignore malformed SSE chunks */
      }
    }
  }
}

// Training
export const endTraining = (recordId: number | string, signal?: AbortSignal) =>
  api.post<Schemas["ScoringTriggerResponse"]>(`/training/${recordId}/end`, null, { signal });

export const retryScoring = (recordId: number | string) => api.post<Schemas["ScoringTriggerResponse"]>(`/training/${recordId}/retry-scoring`);

export const getRecords = (params: Record<string, unknown> = {}) => api.get<Schemas["PaginatedResponse_TrainingRecordBrief_"]>("/training/records", { params });

export const deleteRecord = (id: number | string) => api.delete<Schemas["MessageResponse"]>(`/training/records/${id}`);

export const getRecordDetail = (id: number | string) => api.get<Schemas["TrainingRecordDetail"]>(`/training/records/${id}`);

// Export
export const exportRecords = () => api.get<Blob>("/export/records", { responseType: "blob" });

export const exportRecordDetail = (id: number | string) => api.get<Blob>(`/export/record/${id}`, { responseType: "blob" });

// Admin - Users
export const getUsers = (params: Record<string, unknown> = {}) => api.get<Schemas["PaginatedResponse_UserBrief_"]>("/admin/users", { params });

export const getStats = () => api.get<Schemas["AdminStats"]>("/admin/stats");

// Q&A
export const createQASession = (question: string) => api.post<Schemas["QAAskResponse"]>("/qa/sessions", { question });

export const getQASessions = () => api.get<Schemas["QASessionItem"][]>("/qa/sessions");

export const deleteQASession = (id: number | string) => api.delete<Schemas["MessageResponse"]>(`/qa/sessions/${id}`);

export const getQASessionMessages = (sessionId: number | string) => api.get<Schemas["QAMessageItem"][]>(`/qa/sessions/${sessionId}/messages`);

export const askInQASession = (sessionId: number | string, question: string) =>
  api.post<Schemas["QAAskResponse"]>(`/qa/sessions/${sessionId}/ask`, { question });

export const getQAHistoryAll = (params: Record<string, unknown> = {}) =>
  api.get<Schemas["PaginatedResponse_QASessionAdminItem_"]>("/qa/history/all", { params });

export const getQASessionMessagesAdmin = (sessionId: number | string) => api.get<Schemas["QAMessageItem"][]>(`/qa/history/all/${sessionId}/messages`);

// Duration stats
export const getDurationStats = (period = "month") => api.get<Schemas["DurationStats"]>(`/stats/duration?period=${period}`);

export const getTrends = (period = "month") => api.get<Schemas["TrendStats"]>(`/stats/trends?period=${period}`);

export const getTeacherSummary = (params: Record<string, unknown> = {}) =>
  api.get<Schemas["PaginatedResponse_TeacherSummaryItem_"]>("/stats/teacher-summary", { params });

export const getStudentRanking = (params: Record<string, unknown> = {}) => api.get<Schemas["PaginatedResponse_RankingItem_"]>("/stats/ranking", { params });

// User management
export const updateUser = (id: number | string, data: Schemas["UserUpdateRequest"]) => api.put<Schemas["UserBrief"]>(`/admin/users/${id}`, data);

export const batchCreateUsers = (users: Schemas["BatchUserItem"][]) => api.post<Schemas["BatchCreateResult"]>("/admin/users/batch", users);

export const deleteUser = (id: number | string) => api.delete<Schemas["MessageResponse"]>(`/admin/users/${id}`);

export const getStudentDetail = (userId: number | string) => api.get<Schemas["StudentDetail"]>(`/admin/users/${userId}/detail`);

// Roles
export const getRoles = () =>
  api.get<{ id: number; name: string; display_name: string; is_system: boolean; permissions: string[]; user_count: number }[]>("/admin/roles");

// Case management
export const getManageCases = (params: Record<string, unknown> = {}) => api.get<Schemas["PaginatedResponse_CaseManageItem_"]>("/cases/manage/list", { params });

export const createCase = (data: Schemas["CaseCreateRequest"]) => api.post<Schemas["CaseManageItem"]>("/cases", data);

export const updateCase = (id: number | string, data: Schemas["CaseUpdateRequest"]) => api.put<Schemas["CaseManageItem"]>(`/cases/${id}`, data);

export const deleteCase = (id: number | string) => api.delete<Schemas["MessageResponse"]>(`/cases/${id}`);

// LLM monitoring
export const getLLMStats = () => api.get<Schemas["LLMStatsResponse"]>("/admin/llm-stats");

export const getLLMLogs = (params: Record<string, unknown> = {}) =>
  api.get<Schemas["PaginatedResponse_LLMCallLogItem_"]>("/admin/llm-logs", {
    params: { aggregate_patient_chat: true, ...params },
  });

export const exportLLMLogs = (dateFrom?: string, dateTo?: string) => {
  const params: Record<string, string> = {};
  if (dateFrom) params.date_from = dateFrom;
  if (dateTo) params.date_to = dateTo;
  return api.get<Blob>("/admin/llm-logs/export", { params, responseType: "blob" });
};

// Score review
export const getScoreReview = (recordId: number | string) => api.get<Schemas["ScoreReviewResponse"]>(`/training/records/${recordId}/review`);

export const submitScoreReview = (recordId: number | string, data: Schemas["ScoreReviewRequest"]) =>
  api.post<Schemas["ScoreReviewResponse"]>(`/training/records/${recordId}/review`, data);

// Feedback
export const submitFeedback = (data: Schemas["FeedbackSubmit"]) => api.post<Schemas["FeedbackSubmitResponse"]>("/feedback", data);

export const getFeedbacks = (params: Record<string, unknown> = {}) => api.get<Schemas["PaginatedResponse_FeedbackItem_"]>("/admin/feedback", { params });

export const getFeedbackStats = (params: Record<string, unknown> = {}) => api.get<Schemas["FeedbackDailyItem"][]>("/admin/feedback/stats", { params });

export const generateCase = (data: Schemas["CaseGenerateRequest"]) => api.post<Schemas["CaseGenerateResponse"]>("/cases/generate", data);

// Grade management
export const getGrades = () => api.get<Schemas["GradeResponse"][]>("/admin/grades");

export const createGrade = (data: Schemas["GradeCreate"]) => api.post<Schemas["GradeResponse"]>("/admin/grades", data);

export const updateGrade = (id: number | string, data: Schemas["GradeUpdate"]) => api.put<Schemas["GradeResponse"]>(`/admin/grades/${id}`, data);

export const deleteGrade = (id: number | string) => api.delete(`/admin/grades/${id}`);

// Class management
export const getClasses = (params: Record<string, unknown> = {}) => api.get<Schemas["ClassResponse"][]>("/admin/classes", { params });

export const createClass = (data: Schemas["ClassCreate"]) => api.post<Schemas["ClassResponse"]>("/admin/classes", data);

export const updateClass = (id: number | string, data: Schemas["ClassUpdate"]) => api.put<Schemas["ClassResponse"]>(`/admin/classes/${id}`, data);

export const deleteClass = (id: number | string) => api.delete(`/admin/classes/${id}`);

// Class stats
export const getClassSummary = (params: Record<string, unknown> = {}) => api.get<Schemas["ClassSummaryItemSchema"][]>("/stats/class-summary", { params });

// Rubric
export const fetchRubrics = () => api.get<Schemas["RubricResponse"][]>("/admin/api/rubrics");

export const getActiveRubric = () => api.get<Schemas["RubricResponse"]>("/admin/api/rubrics/active");

export const createRubric = (data: Record<string, unknown>) => api.post<Schemas["RubricResponse"]>("/admin/api/rubrics", data);

export const updateRubric = (id: number | string, data: Record<string, unknown>) => api.put<Schemas["RubricResponse"]>(`/admin/api/rubrics/${id}`, data);

export const deleteRubric = (id: number | string) => api.delete(`/admin/api/rubrics/${id}`);

export const activateRubric = (id: number | string) => api.post(`/admin/api/rubrics/${id}/activate`);

// ── API Management ──

export const fetchSecrets = () => api.get<Schemas["ApiSecretResponse"][]>("/admin/api/secrets");

export const createSecret = (data: Schemas["ApiSecretCreate"]) => api.post<Schemas["SecretCreateResponse"]>("/admin/api/secrets", data);

export const updateSecret = (id: number | string, data: Schemas["ApiSecretUpdate"]) => api.put<Schemas["ApiSecretResponse"]>(`/admin/api/secrets/${id}`, data);

export const deleteSecret = (id: number | string) => api.delete<Schemas["OkResponse"]>(`/admin/api/secrets/${id}`);

export const fetchConfigs = (purpose?: string) => {
  const params: Record<string, string> = {};
  if (purpose) params.purpose = purpose;
  return api.get<Schemas["LLMConfigResponse"][]>("/admin/api/configs", { params });
};

export const createConfig = (data: Schemas["LLMConfigCreate"]) => api.post<Schemas["ConfigCreateResponse"]>("/admin/api/configs", data);

export const updateConfig = (id: number | string, data: Schemas["LLMConfigUpdate"]) => api.put<Schemas["LLMConfigResponse"]>(`/admin/api/configs/${id}`, data);

export const deleteConfig = (id: number | string) => api.delete<Schemas["OkResponse"]>(`/admin/api/configs/${id}`);

export const toggleConfig = (id: number | string) => api.post<Schemas["ToggleStatusResponse"]>(`/admin/api/configs/${id}/toggle`);

export const resetConfig = (id: number | string) => api.post<Schemas["OkResponse"]>(`/admin/api/configs/${id}/reset`);

export const testConfig = (id: number | string) => api.post<Schemas["TestResultItem"]>(`/admin/api/configs/${id}/test`);

export const testAllConfigs = () => api.post<Schemas["TestAllResultsResponse"]>("/admin/api/configs/test-all");

export const reloadRouter = () => api.post<Schemas["OkResponse"]>("/admin/api/reload");

export const checkHealth = () => api.get<Schemas["HealthCheckItem"][]>("/admin/api/health");

// Environment fallback
export const fetchEnvFallback = () => api.get("/admin/api/fallback");

export const testEnvFallback = () => api.post<Schemas["TestResultItem"]>("/admin/api/fallback/test");

export interface ModelPresetItem {
  name: string;
  price_input: number;
  price_output: number;
}

export interface ProviderPreset {
  provider: string;
  display_name: string;
  base_url: string;
  models: ModelPresetItem[];
}

export const fetchModelPresets = () => api.get<{ providers: ProviderPreset[] }>("/admin/api/model-presets");

// Prompts
export const fetchPrompts = (purpose?: string) => {
  const params: Record<string, string> = {};
  if (purpose) params.purpose = purpose;
  return api.get<Schemas["PromptTemplateResponse"][]>("/admin/prompts", { params });
};

export const createPrompt = (data: Schemas["PromptTemplateCreate"]) => api.post<Schemas["PromptTemplateResponse"]>("/admin/prompts", data);

export const updatePrompt = (id: number | string, data: Schemas["PromptTemplateUpdate"]) =>
  api.put<Schemas["PromptTemplateResponse"]>(`/admin/prompts/${id}`, data);

export const deletePrompt = (id: number | string) => api.delete<Schemas["OkResponse"]>(`/admin/prompts/${id}`);

export const activatePrompt = (id: number | string, purpose?: string) =>
  api.post<Schemas["PromptTemplateResponse"]>(`/admin/prompts/${id}/activate${purpose ? `?purpose=${encodeURIComponent(purpose)}` : ""}`);

export const validatePrompt = (data: Schemas["PromptValidateRequest"]) => api.post<Schemas["PromptValidateResponse"]>("/admin/prompts/validate", data);

export const reloadPrompts = () => api.post<Schemas["OkResponse"]>("/admin/prompts/reload");

export const previewActivePrompt = (purpose: string) => api.get<Schemas["PromptPreviewResponse"]>("/admin/prompts/active/preview", { params: { purpose } });

export const fetchSampleVars = (purpose: string) => api.get<Schemas["SampleVarsResponse"]>("/admin/prompts/sample-vars", { params: { purpose } });

// Session Configs
export const getSessionConfigs = () => api.get<Record<string, unknown>[]>("/training/configs");

// Training State (debug)
export const getTrainingState = (recordId: number) => api.get<Schemas["TrainingStateResponse"]>(`/training/${recordId}/state`);

export const triggerInitiative = (recordId: number) => api.post<Schemas["InitiativeTriggerResponse"]>(`/training/${recordId}/initiative/trigger`);

// Nursing Records
export const getNursingRecord = (recordId: number) => api.get<Record<string, unknown>>(`/nursing-records/${recordId}`);

export const saveNursingRecord = (recordId: number, data: Record<string, unknown>) => api.post<Record<string, unknown>>(`/nursing-records/${recordId}`, data);

// Questionnaires
export const getQuestionnairesTemplates = (params?: Record<string, unknown>) =>
  api.get<Schemas["PaginatedResponse_QuestionnaireTemplateResponse_"]>("/questionnaires/templates", { params });

export const createQuestionnaireTemplate = (data: Schemas["QuestionnaireTemplateCreate"]) =>
  api.post<Schemas["QuestionnaireTemplateDetailResponse"]>("/questionnaires/templates", data);

export const getQuestionnaireTemplate = (id: number) => api.get<Schemas["QuestionnaireTemplateDetailResponse"]>(`/questionnaires/templates/${id}`);

export const updateQuestionnaireTemplate = (id: number, data: Schemas["QuestionnaireTemplateUpdate"]) =>
  api.put<Schemas["QuestionnaireTemplateDetailResponse"]>(`/questionnaires/templates/${id}`, data);

export const deleteQuestionnaireTemplate = (id: number) => api.delete<Schemas["OkResponse"]>(`/questionnaires/templates/${id}`);

export const checkQuestionnaire = (params: { case_id?: number; record_id?: number; trigger?: string }) =>
  api.get<Schemas["QuestionnaireCheckResponse"]>("/questionnaires/check", { params });

export const submitQuestionnaire = (data: Schemas["QuestionnaireSubmitRequest"]) =>
  api.post<Schemas["QuestionnaireResponseItem"]>("/questionnaires/responses", data);

export const getQuestionnaireResponses = (templateId: number, params?: Record<string, unknown>) =>
  api.get<Schemas["PaginatedResponse_QuestionnaireResponseItem_"]>(`/questionnaires/responses/${templateId}`, { params });

export const getQuestionnaireStats = (templateId: number) => api.get<Schemas["QuestionnaireStatsResponse"]>(`/questionnaires/responses/${templateId}/stats`);

export const exportQuestionnaireCSV = (templateId: number) => api.get(`/questionnaires/responses/${templateId}/export`, { responseType: "blob" });
