import { get, post, request } from "./client"

export interface TrainingRecordBrief {
  id: number
  case_id: number
  case_name: string
  start_time: string
  end_time: string | null
  status: string
  score_total: number | null
  scoring_status: string | null
}

export interface TrainingRecordDetail {
  id: number
  case_id: number
  case_name: string
  user_id: number
  start_time: string
  end_time: string | null
  status: string
  time_limit: number
  remaining_seconds: number | null
  messages: MessageItem[]
  score: ScoreData | null
  scoring_status: string | null
  scoring_error: string | null
  required_inquiries: string[] | null
  patient_info: PatientInfo | null
  notes: string | null
}

export interface PatientInfo {
  name?: string
  age?: number
  gender?: string
  chief_complaint?: string
}

export interface MessageItem {
  id: number
  role: string
  content: string
  streaming?: boolean
}

export interface ScoreData {
  total_score: number
  detail_scores?: Record<string, { score: number; max: number; items?: ScoreItem[] }>
  strengths?: string[]
  weaknesses?: string[]
  missed_content?: string[]
  suggestions?: string
  rubric_version?: string
}

export interface ScoreItem {
  id: number
  name: string
  score: number
  evidence?: string
  reason?: string
}

export interface StartTrainingRequest {
  case_id: number
}

export interface StartTrainingResponse {
  record_id: number
  greeting: string
  case_name: string
}

export function startTraining(data: StartTrainingRequest) {
  return post<StartTrainingResponse>("/api/training/start", data as unknown as Record<string, unknown>)
}

export function endTraining(recordId: number) {
  return post<{ message: string; record_id: number; scoring_status: string }>(
    `/api/training/${recordId}/end`,
  )
}

export function getRecords(params?: {
  offset?: number
  limit?: number
  status?: string
}) {
  return get<PaginatedResponse<TrainingRecordBrief>>(
    "/api/training/records",
    params as Record<string, string | number | undefined>,
  )
}

export function getRecordDetail(recordId: number) {
  return get<TrainingRecordDetail>(`/api/training/records/${recordId}`)
}

export function deleteRecord(recordId: number) {
  return request<{ message: string }>("DELETE", `/api/training/records/${recordId}`)
}


