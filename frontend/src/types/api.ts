import type { AxiosResponse } from "axios";
import type { PaginatedResponse, TrainingRecord, QASession, QAMessage, LLMLog, FeedbackItem, Grade, ClassItem } from "./models";

export interface LoginRequest {
  username: string;
  password: string;
}

export interface LoginResponse {
  access_token: string;
  role: "student" | "teacher";
  display_name: string;
  user_id: number;
}

export interface RegisterRequest {
  username: string;
  password: string;
  display_name: string;
  role?: "student" | "teacher";
}

export interface StartTrainingResponse {
  record_id: number;
}

export interface ChatMessageResponse {
  id: number;
  content: string;
  role: "assistant";
}

export interface StreamChunk {
  content?: string;
  done?: boolean;
  id?: number;
  error?: string;
}

export interface EndTrainingResponse {
  score?: number;
  status: "completed";
}

export interface RecordsResponse extends PaginatedResponse<TrainingRecord> {}

export interface QASessionsResponse {
  sessions: QASession[];
}

export interface QACreateResponse {
  session_id: number;
  answer?: string;
}

export interface QAAskResponse {
  answer?: string;
  id?: number;
}

export interface QAMessagesResponse {
  messages: QAMessage[];
}

export interface ClassSummaryItem {
  grade_id: number;
  grade_name: string;
  class_id: number;
  class_name: string;
  student_count: number;
  session_count: number;
  average_score?: number;
}

export interface RubricData {
  id: number;
  name: string;
  is_active: boolean;
  items?: Array<{
    id: number;
    name: string;
    weight: number;
    criteria: string;
  }>;
  created_at?: string;
}

export interface ApiSecret {
  id: number;
  name: string;
  provider?: string;
  is_active?: boolean;
}

export interface ApiConfig {
  id: number;
  purpose: string;
  provider?: string;
  model?: string;
  is_active?: boolean;
  config?: Record<string, unknown>;
}

export interface PromptData {
  id: number;
  purpose: string;
  name: string;
  is_active?: boolean;
  content?: string;
}

export interface ScoreReviewData {
  id?: number;
  record_id: number;
  rubric_scores: Array<{
    item_id: number;
    score: number;
    feedback: string;
  }>;
  total_score: number;
  feedback: string;
}

export type ApiResponse<T> = AxiosResponse<T>;
