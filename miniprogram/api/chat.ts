import { get, post, request } from "./client"

const BASE_URL = () => {
  const app = getApp<IAppOption>()
  return app.globalData.baseUrl || "http://localhost:8000"
}

const getToken = () => {
  const app = getApp<IAppOption>()
  return app.globalData.token || wx.getStorageSync("access_token") || ""
}

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

export type StreamEventType = "content" | "system" | "done" | "error"

export interface StreamEvent {
  type: StreamEventType
  text?: string
  error?: string
}

export function streamMessage(
  recordId: number,
  data: SendMessageRequest,
  onEvent: (event: StreamEvent) => void,
  onComplete: () => void,
): { abort: () => void } {
  const token = getToken()
  const url = `${BASE_URL()}/api/chat/${recordId}/message/stream`
  let processedLen = 0
  let aborted = false
  let requestTask: WechatMiniprogram.RequestTask | null = null

  requestTask = wx.request({
    url,
    method: "POST",
    data,
    enableChunked: true,
    header: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    success(res) {
      if (aborted) return
      if (res.statusCode !== 200) {
        const detail = (res.data as { detail?: string })?.detail || "请求失败"
        onEvent({ type: "error", error: detail })
        onComplete()
        return
      }
      const text = typeof res.data === "string" ? res.data : JSON.stringify(res.data)
      processChunk(text)
    },
    fail(err) {
      if (aborted) return
      onEvent({ type: "error", error: err.errMsg || "网络错误" })
      onComplete()
    },
  })

  function processChunk(text: string) {
    if (aborted) return
    const newPart = text.slice(processedLen)
    if (!newPart) return

    const events = newPart.split("\n\n")
    for (const event of events) {
      if (!event.trim()) continue
      const lines = event.split("\n")
      for (const line of lines) {
        if (line.startsWith("data: ")) {
          try {
            const json = JSON.parse(line.slice(6))
            if (json.content) {
              onEvent({ type: "content", text: json.content })
            } else if (json.system) {
              onEvent({ type: "system", text: json.system })
            } else if (json.done) {
              processedLen = text.length
              onComplete()
              return
            }
          } catch { /* skip malformed JSON */ }
        }
      }
    }
    processedLen = text.length - (events[events.length - 1] || "").length
  }

  return {
    abort() {
      aborted = true
      requestTask?.abort()
    },
  }
}
