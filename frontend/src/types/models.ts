export interface User {
  user_id: number;
  username?: string;
  role: "student" | "teacher";
  display_name: string;
  avatar?: string;
  grade?: string;
  className?: string;
}

export interface PatientCase {
  id: number;
  title: string;
  description: string;
  difficulty: "easy" | "medium" | "hard";
  category?: string;
  tags?: string[];
  age?: number;
  gender?: string;
  background?: string;
  symptoms?: string;
}

export interface Message {
  id: number;
  role: "user" | "assistant" | "system";
  content: string;
  created_at?: string;
}

export interface TrainingRecord {
  id: number;
  user_id: number;
  case_id: number;
  case_title?: string;
  patient_name?: string;
  score?: number;
  status: "active" | "completed" | "abandoned";
  created_at: string;
  updated_at: string;
  messages?: Message[];
}

export interface RecordDetail extends TrainingRecord {
  rubric_scores?: ScoreResult[];
  total_score?: number;
  feedback?: string;
  patient_info?: PatientInfo;
}

export interface PatientInfo {
  name: string;
  age: number;
  gender: string;
  chief_complaint?: string;
  avatar_key?: string;
}

export interface RubricItem {
  id: number;
  name: string;
  weight: number;
  criteria: string;
}

export interface ScoreResult {
  item_id: number;
  item_name: string;
  score: number;
  max_score: number;
  feedback: string;
}

export interface Grade {
  id: number;
  name: string;
}

export interface ClassItem {
  id: number;
  name: string;
  grade_id: number;
  grade_name?: string;
}

export interface QASession {
  id: number;
  question: string;
  created_at: string;
  message_count?: number;
}

export interface QAMessage {
  id: number;
  role: "user" | "assistant";
  content: string;
  created_at: string;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  offset: number;
  limit: number;
}

export interface LLMLog {
  id: number;
  user_id?: number;
  username?: string;
  model: string;
  purpose: string;
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  duration_ms?: number;
  success: boolean;
  error?: string;
  created_at: string;
}

export interface FeedbackItem {
  id: number;
  user_id?: number;
  username?: string;
  type: string;
  content: string;
  rating?: number;
  created_at: string;
}

export interface DurationStat {
  period: string;
  average_minutes: number;
  total_sessions: number;
}

export interface TrendItem {
  date: string;
  count: number;
}

export interface TeacherSummary {
  total_students: number;
  total_sessions: number;
  total_cases: number;
  average_score?: number;
}

export interface StudentRanking {
  user_id: number;
  display_name: string;
  grade?: string;
  class?: string;
  session_count: number;
  average_score?: number;
}

export type Role = "student" | "teacher";
export type Difficulty = "easy" | "medium" | "hard";
export type RecordStatus = "active" | "completed" | "abandoned";
export type ToastType = "success" | "error" | "warning" | "info";
