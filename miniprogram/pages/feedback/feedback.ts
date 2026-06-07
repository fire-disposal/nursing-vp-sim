import { submitFeedback } from "../../api/feedback"

const TAGS = ["功能建议", "界面体验", "训练内容", "评分反馈", "Bug报告", "其他"]

Page({
  data: {
    stars: [1, 2, 3, 4, 5],
    rating: 0,
    tags: TAGS,
    tag: "",
    content: "",
    submitting: false,
  },

  setRating(e: WechatMiniprogram.TouchEvent) {
    this.setData({ rating: Number(e.currentTarget.dataset.value) })
  },

  setTag(e: WechatMiniprogram.TouchEvent) {
    const t = e.currentTarget.dataset.tag as string
    this.setData({ tag: this.data.tag === t ? "" : t })
  },

  onContentInput(e: WechatMiniprogram.Input) {
    this.setData({ content: e.detail.value })
  },

  async handleSubmit() {
    if (!this.data.rating || !this.data.tag) return
    this.setData({ submitting: true })
    try {
      await submitFeedback({
        rating: this.data.rating,
        tag: this.data.tag,
        content: this.data.content || undefined,
      })
      wx.showToast({ title: "感谢反馈！", icon: "success" })
      setTimeout(() => wx.navigateBack(), 1500)
    } catch {
      wx.showToast({ title: "提交失败", icon: "none" })
    } finally {
      this.setData({ submitting: false })
    }
  },

  goBack() {
    wx.navigateBack()
  },
})
