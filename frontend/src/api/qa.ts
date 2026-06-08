import type { components } from "./api-types.gen";
import { api } from "./axios-instance";

type Schemas = components["schemas"];

export const createQASession = (question: string) => api.post<Schemas["QAAskResponse"]>("/qa/sessions", { question });

export const getQASessions = () => api.get<Schemas["QASessionItem"][]>("/qa/sessions");

export const deleteQASession = (id: number | string) => api.delete<Schemas["MessageResponse"]>(`/qa/sessions/${id}`);

export const getQASessionMessages = (sessionId: number | string) => api.get<Schemas["QAMessageItem"][]>(`/qa/sessions/${sessionId}/messages`);

export const askInQASession = (sessionId: number | string, question: string) =>
  api.post<Schemas["QAAskResponse"]>(`/qa/sessions/${sessionId}/ask`, { question });

export const getQAHistoryAll = (params: Record<string, unknown> = {}) =>
  api.get<Schemas["PaginatedResponse_QASessionAdminItem_"]>("/qa/history/all", { params });

export const getQASessionMessagesAdmin = (sessionId: number | string) => api.get<Schemas["QAMessageItem"][]>(`/qa/history/all/${sessionId}/messages`);

export async function askInQASessionStream(
  sessionId: number | string,
  question: string,
  onChunk: (text: string) => void,
  onDone: (id?: number) => void,
  onError: (msg: string) => void,
  signal?: AbortSignal,
) {
  const token = localStorage.getItem("token");
  const resp = await fetch(`/api/qa/sessions/${sessionId}/ask/stream`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ question }),
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
