import { createQASession, deleteQASession, getQASessionMessages, getQASessions, askInQASession, type QASessionItem, type QAMessageItem } from "../../api/qa"

let _msgIdCounter = 0

Page({
  data: {
    sessions: [] as QASessionItem[],
    messages: [] as QAMessageItem[],
    selectedSessionId: 0,
    selectedTitle: "",
    input: "",
    sending: false,
    loadingSessions: true,
    loadingMessages: false,
    sessionsError: "",
    showSidebar: false,
  },

  onShow() {
    this.loadSessions()
  },

  async onPullDownRefresh() {
    await this.loadSessions()
    wx.stopPullDownRefresh()
  },

  async loadSessions() {
    this.setData({ loadingSessions: true, sessionsError: "" })
    try {
      const res = await getQASessions({ limit: 50 })
      this.setData({ sessions: res.items || [], loadingSessions: false })
    } catch {
      this.setData({ loadingSessions: false, sessionsError: "加载失败" })
    }
  },

  onToggleSidebar() {
    this.setData({ showSidebar: !this.data.showSidebar })
  },

  async onSelectSession(e: WechatMiniprogram.BaseEvent) {
    const session = e.currentTarget.dataset.session as QASessionItem
    this.setData({
      selectedSessionId: session.id,
      selectedTitle: session.title,
      showSidebar: false,
      loadingMessages: true,
    })
    try {
      const res = await getQASessionMessages(session.id, { limit: 100 })
      this.setData({ messages: res.items || [], loadingMessages: false })
    } catch {
      this.setData({ loadingMessages: false })
    }
  },

  async onNewSession() {
    const content = this.data.input.trim()
    if (!content || this.data.sending) return

    this.setData({ sending: true, input: "" })

    try {
      const res = await createQASession({ question: content })
      this.setData({ sending: false, selectedSessionId: res.session_id, selectedTitle: content.slice(0, 20) })
      await this.loadSessions()
      const msgs = await getQASessionMessages(res.session_id, { limit: 100 })
      this.setData({ messages: msgs.items || [] })
    } catch {
      this.setData({ sending: false })
      wx.showToast({ title: "发送失败", icon: "none" })
    }
  },

  async handleSend() {
    const content = this.data.input.trim()
    if (!content || this.data.sending) return

    const sid = this.data.selectedSessionId
    if (!sid) {
      await this.onNewSession()
      return
    }

    this.setData({ sending: true, input: "" })

    try {
      const res = await askInQASession(sid, { question: content })
      const msgs = await getQASessionMessages(sid, { limit: 100 })
      this.setData({ messages: msgs.items || [], sending: false })
    } catch {
      this.setData({ sending: false })
      wx.showToast({ title: "发送失败", icon: "none" })
    }
  },

  async onDeleteSession() {
    const sid = this.data.selectedSessionId
    if (!sid) return
    const res = await new Promise<WechatMiniprogram.ShowModalSuccessCallbackResult>((resolve) => {
      wx.showModal({
        title: "删除会话",
        content: "确定删除此问答会话吗？",
        confirmColor: "#dc2626",
        success: resolve,
      })
    })
    if (!res.confirm) return

    try {
      await deleteQASession(sid)
      this.setData({ selectedSessionId: 0, selectedTitle: "", messages: [] })
      this.loadSessions()
    } catch {
      wx.showToast({ title: "删除失败", icon: "none" })
    }
  },

  onInput(e: WechatMiniprogram.Input) {
    this.setData({ input: e.detail.value })
  },
})
