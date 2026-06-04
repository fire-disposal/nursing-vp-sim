import { sendMessage } from "../../api/chat"
import { endTraining, getRecordDetail, type MessageItem } from "../../api/training"
import { formatTime } from "../../utils/format"

interface ChatMessage {
  id: number
  role: string
  content: string
}

Page({
  data: {
    recordId: 0,
    caseName: "",
    patientName: "患者",
    messages: [] as ChatMessage[],
    input: "",
    sending: false,
    ending: false,
    remaining: 0,
    timerStr: "--:--",
    showScore: false,
    score: null as Record<string, unknown> | null,
  },

  timerInterval: 0 as unknown as ReturnType<typeof setInterval>,

  onLoad(options: Record<string, string>) {
    const recordId = Number(options.recordId)
    const caseName = decodeURIComponent(options.caseName || "")
    const greeting = decodeURIComponent(options.greeting || "")

    this.setData({ recordId, caseName })

    if (greeting) {
      this.setData({
        messages: [{ id: 1, role: "patient", content: greeting }],
      })
    }

    this.loadDetail(recordId)
    this.startTimer()
  },

  onUnload() {
    if (this.timerInterval) clearInterval(this.timerInterval)
  },

  async loadDetail(recordId: number) {
    try {
      const detail = await getRecordDetail(recordId)
      this.setData({
        remaining: detail.remaining_seconds ?? 0,
        messages: (detail.messages || []).map((m: MessageItem) => ({
          id: m.id,
          role: m.role,
          content: m.content,
        })),
      })
      if (detail.patient_info?.name) {
        this.setData({ patientName: detail.patient_info.name })
      }
    } catch { /* ignore */ }
  },

  startTimer() {
    if (this.timerInterval) clearInterval(this.timerInterval)
    this.timerInterval = setInterval(() => {
      const r = this.data.remaining
      if (r == null || r <= 0) {
        clearInterval(this.timerInterval)
        return
      }
      this.setData({
        remaining: r - 1,
        timerStr: formatTime(r - 1),
      })
    }, 1000)
  },

  onInput(e: WechatMiniprogram.Input) {
    this.setData({ input: e.detail.value })
  },

  async handleSend() {
    const content = this.data.input.trim()
    if (!content || this.data.sending) return

    const studentId = Date.now()
    const patientId = studentId + 1

    this.setData({
      input: "",
      sending: true,
      messages: [
        ...this.data.messages,
        { id: studentId, role: "student", content },
        { id: patientId, role: "patient", content: "..." },
      ],
    })

    try {
      const res = await sendMessage(this.data.recordId, { content })
      this.setData({
        messages: this.data.messages.map((m) =>
          m.id === patientId ? { ...m, content: res.content } : m,
        ),
      })
    } catch {
      this.setData({
        messages: this.data.messages.filter((m) => m.id !== patientId),
      })
      wx.showToast({ title: "发送失败", icon: "none" })
    } finally {
      this.setData({ sending: false })
      this.scrollToBottom()
    }
  },

  async handleEnd() {
    if (this.data.ending) return
    wx.showModal({
      title: "结束训练",
      content: "确定要结束本次训练吗？结束后系统将自动评分。",
      confirmText: "确认结束",
      cancelText: "继续训练",
      success: async (res) => {
        if (!res.confirm) return
        this.setData({ ending: true })
        try {
          const result = await endTraining(this.data.recordId)
          wx.showToast({ title: "已结束，正在评分...", icon: "none" })
          this.pollScore(result.record_id)
        } catch {
          this.setData({ ending: false })
        }
      },
    })
  },

  async pollScore(recordId: number) {
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 3000))
      try {
        const detail = await getRecordDetail(recordId)
        if (detail.scoring_status === "completed" && detail.score) {
          this.setData({ showScore: true, score: detail.score as unknown as Record<string, unknown> })
          return
        }
        if (detail.scoring_status === "failed") {
          wx.showToast({ title: "评分失败", icon: "none" })
          this.setData({ ending: false })
          return
        }
      } catch { /* retry */ }
    }
    wx.showToast({ title: "评分超时，请稍后在记录中查看", icon: "none" })
    this.setData({ ending: false })
  },

  goBack() {
    if (this.data.messages.length > 1) {
      wx.showModal({
        title: "离开训练",
        content: "训练还在进行中，离开将丢失进度",
        confirmText: "确认离开",
        success: (res) => {
          if (res.confirm) wx.redirectTo({ url: "/pages/home/home" })
        },
      })
    } else {
      wx.redirectTo({ url: "/pages/home/home" })
    }
  },

  scrollToBottom() {
    wx.createSelectorQuery()
      .select("#msg-end")
      .boundingClientRect()
      .exec((res) => {
        if (res[0]) {
          wx.pageScrollTo({ scrollTop: res[0].top + 9999, duration: 300 })
        }
      })
  },
})
