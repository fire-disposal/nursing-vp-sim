import { sendMessage } from "../../api/chat"
import { endTraining, getRecordDetail, type MessageItem } from "../../api/training"
import { formatTime } from "../../utils/format"

interface ChatMessage {
  id: number
  role: string
  content: string
}

let _msgIdCounter = 0

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
    scoringStatus: "",
  },

  timerInterval: 0 as unknown as ReturnType<typeof setInterval>,
  syncInterval: 0 as unknown as ReturnType<typeof setInterval>,
  sessionActive: false,

  onLoad(options: Record<string, string>) {
    const recordId = Number(options.recordId)
    const caseName = decodeURIComponent(options.caseName || "")
    const greeting = decodeURIComponent(options.greeting || "")

    this.setData({ recordId, caseName })

    if (greeting) {
      this.setData({
        messages: [{ id: ++_msgIdCounter, role: "patient", content: greeting }],
      })
    }

    this.loadDetail(recordId)
  },

  onUnload() {
    this.clearTimers()
  },

  onHide() {
    this.clearTimers()
  },

  onShow() {
    if (this.data.recordId && this.sessionActive && !this.data.showScore) {
      this.syncTimer()
      this.startTimer()
    }
  },

  clearTimers() {
    if (this.timerInterval) { clearInterval(this.timerInterval); this.timerInterval = 0 as unknown as ReturnType<typeof setInterval> }
    if (this.syncInterval) { clearInterval(this.syncInterval); this.syncInterval = 0 as unknown as ReturnType<typeof setInterval> }
  },

  async loadDetail(recordId: number) {
    try {
      const detail = await getRecordDetail(recordId)
      if (detail.status !== "in_progress") {
        wx.showToast({ title: "训练已结束", icon: "none" })
        setTimeout(() => wx.redirectTo({ url: `/pages/record-detail/record-detail?id=${recordId}` }), 1500)
        return
      }
      this.sessionActive = true
      this.setData({
        remaining: detail.remaining_seconds ?? 0,
        timerStr: formatTime(detail.remaining_seconds ?? 0),
        messages: (detail.messages || []).map((m: MessageItem) => ({
          id: m.id,
          role: m.role,
          content: m.content,
        })),
      })
      if (detail.patient_info?.name) {
        this.setData({ patientName: detail.patient_info.name })
      }
      this.startTimer()
      this.syncTimer()
    } catch { /* ignore */ }
  },

  startTimer() {
    if (this.timerInterval) clearInterval(this.timerInterval)
    this.timerInterval = setInterval(() => {
      const r = this.data.remaining
      if (r == null || r <= 0) {
        clearInterval(this.timerInterval)
        this.handleEnd()
        return
      }
      this.setData({
        remaining: r - 1,
        timerStr: formatTime(r - 1),
      })
    }, 1000) as unknown as ReturnType<typeof setInterval>
  },

  syncTimer() {
    if (this.syncInterval) clearInterval(this.syncInterval)
    this.syncInterval = setInterval(async () => {
      try {
        const detail = await getRecordDetail(this.data.recordId)
        if (detail.remaining_seconds != null) {
          this.setData({
            remaining: detail.remaining_seconds,
            timerStr: formatTime(detail.remaining_seconds),
          })
        }
        if (detail.status !== "in_progress" && !this.data.showScore) {
          this.clearTimers()
          this.sessionActive = false
          if (detail.score) {
            this.setData({ showScore: true, score: detail.score as unknown as Record<string, unknown>, ending: true })
          }
        }
      } catch { /* silent */ }
    }, 30000) as unknown as ReturnType<typeof setInterval>
  },

  onInput(e: WechatMiniprogram.Input) {
    this.setData({ input: e.detail.value })
  },

  async handleSend() {
    const content = this.data.input.trim()
    if (!content || this.data.sending || this.data.ending) return

    const studentId = ++_msgIdCounter
    const patientId = ++_msgIdCounter

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
    } finally {
      this.setData({ sending: false })
    }
  },

  async handleEnd() {
    if (this.data.ending) return
    this.setData({ ending: true, scoringStatus: "pending" })
    this.clearTimers()
    this.sessionActive = false

    try {
      const result = await endTraining(this.data.recordId)
      if (result.scoring_status === "completed") {
        const detail = await getRecordDetail(this.data.recordId)
        if (detail.score) {
          this.setData({ showScore: true, score: detail.score as unknown as Record<string, unknown>, scoringStatus: "completed" })
          return
        }
      }
      wx.showToast({ title: "已结束，正在评分...", icon: "none" })
      this.pollScore(result.record_id)
    } catch {
      this.setData({ ending: false, scoringStatus: "" })
    }
  },

  async pollScore(recordId: number) {
    const delays = [3000, 3000, 5000, 5000, 8000, 8000, 10000, 10000, 15000, 15000, 20000, 30000]
    for (let i = 0; i < delays.length; i++) {
      await new Promise((r) => setTimeout(r, delays[i]))
      try {
        const detail = await getRecordDetail(recordId)
        if (detail.scoring_status === "completed" && detail.score) {
          this.setData({ showScore: true, score: detail.score as unknown as Record<string, unknown>, scoringStatus: "completed" })
          return
        }
        if (detail.scoring_status === "failed") {
          wx.showToast({ title: "评分失败，请稍后重试", icon: "none" })
          this.setData({ ending: false, scoringStatus: "failed" })
          return
        }
        this.setData({ scoringStatus: `评分中 (${Math.round((i + 1) * delays[i] / 1000)}s)` })
      } catch { /* retry */ }
    }
    this.setData({ ending: false, scoringStatus: "timeout" })
    wx.showModal({
      title: "评分进行中",
      content: "评分仍在处理中，可在训练记录中查看结果",
      showCancel: false,
      success: () => wx.redirectTo({ url: "/pages/home/home" }),
    })
  },

  goBack() {
    if (this.data.messages.length > 1 && this.sessionActive) {
      wx.showModal({
        title: "离开训练",
        content: "训练还在进行中，离开不会结束训练，可在历史记录中继续",
        confirmText: "确认离开",
        success: (res) => {
          if (res.confirm) wx.redirectTo({ url: "/pages/home/home" })
        },
      })
    } else {
      wx.redirectTo({ url: "/pages/home/home" })
    }
  },
})
