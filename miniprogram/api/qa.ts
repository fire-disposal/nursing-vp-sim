import { get, post, request } from "./client"

export interface QASessionItem {
  id: number
  title: string
  message_count: number
  created_at: string
  updated_at: string
}

export interface QAMessageItem {
  id: number
  role: string
  content: string
  created_at: string
}

export interface QAAskResponse {
  session_id: number
  answer: string
}

export interface PaginatedResponse<T> {
  items: T[]
  total: number
  offset: number
  limit: number
}

export function getQASessions(params?: { offset?: number; limit?: number }) {
  return get<PaginatedResponse<QASessionItem>>("/api/qa/sessions", params as Record<string, string | number | undefined>)
}

export function getQASessionMessages(sessionId: number, params?: { offset?: number; limit?: number }) {
  return get<PaginatedResponse<QAMessageItem>>(`/api/qa/sessions/${sessionId}/messages`, params as Record<string, string | number | undefined>)
}

export function askInQASession(sessionId: number, data: { question: string }) {
  return post<QAAskResponse>(`/api/qa/sessions/${sessionId}/ask`, data as unknown as Record<string, unknown>)
}

export function createQASession(data: { question: string }) {
  return post<QAAskResponse>("/api/qa/sessions", data as unknown as Record<string, unknown>)
}

export function deleteQASession(sessionId: number) {
  return request<{ message: string }>("DELETE", `/api/qa/sessions/${sessionId}`)
}
