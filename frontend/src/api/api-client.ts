import { api } from "./axios-instance";
import type { components } from "./api-types.gen";

type Schemas = components["schemas"];

// Auth
export const login = (username: string, password: string) => api.post<Schemas["TokenResponse"]>("/auth/login", { username, password });

export const register = (data: Schemas["RegisterRequest"]) => api.post<Schemas["TokenResponse"]>("/auth/register", data);

export const getMe = () => api.get<Schemas["UserBrief"]>("/auth/me");

// Cases
export const getCases = (params: Record<string, unknown> = {}) => api.get<Schemas["PaginatedResponse_CaseBrief_"]>("/cases", { params });

export const getCaseDetail = (id: number | string) => api.get<Schemas["CaseDetail"]>(`/cases/${id}`);

export const startTraining = (caseId: number | string) => api.post<Schemas["TrainingStartResponse"]>("/training/start", { case_id: caseId });

// Chat
export const sendMessage = (recordId: number | string, content: string, signal?: AbortSignal) =>
  api.post<Schemas["ChatMessageResponse"]>(`/chat/${recordId}/message`, { content }, { signal });

export async function sendMessageStream(
  recordId: number | string,
  content: string,
  onChunk: (text: string) => void,
  onDone: (id?: number) => void,
  onError: (msg: string) => void,
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

  const reader = resp.body!.getReader();
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
export const exportRecords = () => api.get("/export/records", { responseType: "blob" });

export const exportRecordDetail = (id: number | string) => api.get(`/export/record/${id}`, { responseType: "blob" });

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
  return api.get("/admin/llm-logs/export", { params, responseType: "blob" });
};

// Score review
export const getScoreReview = (recordId: number | string) => api.get<Schemas["ScoreReviewResponse"]>(`/training/records/${recordId}/review`);

export const submitScoreReview = (recordId: number | string, data: Schemas["ScoreReviewRequest"]) =>
  api.post<Schemas["ScoreReviewResponse"]>(`/training/records/${recordId}/review`, data);

// Feedback
export const submitFeedback = (data: Schemas["FeedbackSubmit"]) => api.post<Schemas["FeedbackSubmitResponse"]>("/feedback", data);

export const getFeedbacks = (params: Record<string, unknown> = {}) => api.get<Schemas["FeedbackListResponse"]>("/admin/feedback", { params });

export const getFeedbackStats = (params: Record<string, unknown> = {}) => api.get<Schemas["FeedbackDailyItem"][]>("/admin/feedback/stats", { params });

export const generateCase = (data: Schemas["CaseGenerateRequest"]) => api.post<Schemas["CaseGenerateResponse"]>("/cases/generate", data);

// Grade management
export async function getGrades() {
  const res = await api.get<Schemas["GradeResponse"][]>("/admin/grades");
  return res.data;
}

export async function createGrade(data: Schemas["GradeCreate"]) {
  const res = await api.post<Schemas["GradeResponse"]>("/admin/grades", data);
  return res.data;
}

export async function updateGrade(id: number | string, data: Schemas["GradeUpdate"]) {
  const res = await api.put<Schemas["GradeResponse"]>(`/admin/grades/${id}`, data);
  return res.data;
}

export async function deleteGrade(id: number | string) {
  const res = await api.delete(`/admin/grades/${id}`);
  return res.data;
}

// Class management
export async function getClasses(params: Record<string, unknown> = {}) {
  const res = await api.get<Schemas["ClassResponse"][]>("/admin/classes", { params });
  return res.data;
}

export async function createClass(data: Schemas["ClassCreate"]) {
  const res = await api.post<Schemas["ClassResponse"]>("/admin/classes", data);
  return res.data;
}

export async function updateClass(id: number | string, data: Schemas["ClassUpdate"]) {
  const res = await api.put<Schemas["ClassResponse"]>(`/admin/classes/${id}`, data);
  return res.data;
}

export async function deleteClass(id: number | string) {
  const res = await api.delete(`/admin/classes/${id}`);
  return res.data;
}

// Class stats
export async function getClassSummary(params: Record<string, unknown> = {}) {
  const res = await api.get<Schemas["ClassSummaryItemSchema"][]>("/stats/class-summary", { params });
  return res.data;
}

// Backup
export const downloadBackup = () => api.post("/admin/backup", null, { responseType: "blob" });

// Rubric
export const fetchRubrics = () => api.get<Schemas["RubricResponse"][]>("/admin/api/rubrics").then((res) => res.data);

export const getActiveRubric = () => api.get<Schemas["RubricBrief"]>("/admin/api/rubrics/active").then((res) => res.data);

export const createRubric = (data: Record<string, unknown>) => api.post<Schemas["RubricResponse"]>("/admin/api/rubrics", data).then((res) => res.data);

export const updateRubric = (id: number | string, data: Record<string, unknown>) =>
  api.put<Schemas["RubricResponse"]>(`/admin/api/rubrics/${id}`, data).then((res) => res.data);

export const deleteRubric = (id: number | string) => api.delete(`/admin/api/rubrics/${id}`).then((res) => res.data);

export const activateRubric = (id: number | string) => api.post(`/admin/api/rubrics/${id}/activate`).then((res) => res.data);

// ── API Management ──

export const fetchSecrets = () => api.get<Schemas["ApiSecretResponse"][]>("/admin/api/secrets");

export const createSecret = (data: Schemas["ApiSecretCreate"]) => api.post<Schemas["SecretCreateResponse"]>("/admin/api/secrets", data);

export const updateSecret = (id: number | string, data: Schemas["ApiSecretUpdate"]) => api.put<Schemas["ApiSecretResponse"]>(`/admin/api/secrets/${id}`, data);

export const deleteSecret = (id: number | string) => api.delete(`/admin/api/secrets/${id}`);

export const fetchConfigs = (purpose?: string) => {
  const params: Record<string, string> = {};
  if (purpose) params.purpose = purpose;
  return api.get<Schemas["LLMConfigResponse"][]>("/admin/api/configs", { params });
};

export const createConfig = (data: Schemas["LLMConfigCreate"]) => api.post<Schemas["ConfigCreateResponse"]>("/admin/api/configs", data);

export const updateConfig = (id: number | string, data: Schemas["LLMConfigUpdate"]) => api.put<Schemas["LLMConfigResponse"]>(`/admin/api/configs/${id}`, data);

export const deleteConfig = (id: number | string) => api.delete(`/admin/api/configs/${id}`);

export const toggleConfig = (id: number | string) => api.post<Schemas["ToggleStatusResponse"]>(`/admin/api/configs/${id}/toggle`);

export const resetConfig = (id: number | string) => api.post<Schemas["OkResponse"]>(`/admin/api/configs/${id}/reset`);

export const testConfig = (id: number | string) => api.post<Schemas["TestResultItem"]>(`/admin/api/configs/${id}/test`);

export const testAllConfigs = () => api.post<Schemas["TestAllResultsResponse"]>("/admin/api/configs/test-all");

export const reloadRouter = () => api.post<Schemas["OkResponse"]>("/admin/api/reload");

export const checkHealth = () => api.get<Schemas["HealthCheckItem"][]>("/admin/api/health");

// Environment fallback
export const fetchEnvFallback = () => api.get("/admin/api/fallback");

export const testEnvFallback = () => api.post<Schemas["TestResultItem"]>("/admin/api/fallback/test");

// Prompts
export const fetchPrompts = (purpose?: string) => {
  const params: Record<string, string> = {};
  if (purpose) params.purpose = purpose;
  return api.get<Schemas["PromptTemplateResponse"][]>("/admin/prompts", { params });
};

export const createPrompt = (data: Schemas["PromptTemplateCreate"]) => api.post<Schemas["PromptTemplateResponse"]>("/admin/prompts", data);

export const updatePrompt = (id: number | string, data: Schemas["PromptTemplateUpdate"]) =>
  api.put<Schemas["PromptTemplateResponse"]>(`/admin/prompts/${id}`, data);

export const deletePrompt = (id: number | string) => api.delete(`/admin/prompts/${id}`);

export const activatePrompt = (id: number | string) => api.post<Schemas["PromptTemplateResponse"]>(`/admin/prompts/${id}/activate`);

export const validatePrompt = (data: Schemas["PromptValidateRequest"]) => api.post<Schemas["PromptValidateResponse"]>("/admin/prompts/validate", data);

export const reloadPrompts = () => api.post("/admin/prompts/reload");

export const previewActivePrompt = (purpose: string) => api.get<Schemas["PromptPreviewResponse"]>("/admin/prompts/active/preview", { params: { purpose } });

export const fetchSampleVars = (purpose: string) => api.get<Schemas["SampleVarsResponse"]>("/admin/prompts/sample-vars", { params: { purpose } });
