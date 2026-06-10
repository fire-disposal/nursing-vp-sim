import type { components } from "./api-types.gen";
import { api } from "./axios-instance";

type Schemas = components["schemas"];

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
  onExamResult?: (result: { type: string; data: Record<string, unknown> }) => void,
  onEmotionChange?: (change: { from: string; to: string; trigger: string }) => void,
  onInitiative?: (data: { content: string }) => void,
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
        if (data.exam_result) {
          onExamResult?.(data.exam_result);
          continue;
        }
        if (data.emotion_change) {
          onEmotionChange?.(data.emotion_change);
          continue;
        }
        if (data.initiative) {
          onInitiative?.(data.initiative);
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
