import { post } from "./client"

export interface SendMessageRequest {
  content: string
}

export interface SendMessageResponse {
  role: string
  content: string
}

export function sendMessage(recordId: number, data: SendMessageRequest) {
  return post<SendMessageResponse>(
    `/api/chat/${recordId}/message`,
    data as unknown as Record<string, unknown>,
  )
}
