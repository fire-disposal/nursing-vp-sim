import { post } from "./client"

export function submitFeedback(data: { rating: number; tag: string; content?: string }) {
  return post<{ id: number; created_at: string }>("/api/feedback", data as unknown as Record<string, unknown>)
}
