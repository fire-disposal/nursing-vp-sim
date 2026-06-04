import { getRecords, deleteRecord, type TrainingRecordBrief } from "../../api/training"
import { formatDate, getScoreGrade } from "../../utils/format"

Page({
  data: {
    records: [] as (TrainingRecordBrief & { scoreLabel?: { label: string; color: string }; timeLabel?: string })[],
    statusFilter: "",
    loading: true,
  },

  onShow() {
    this.loadRecords()
  },

  async loadRecords() {
    this.setData({ loading: true })
    try {
      const params: Record<string, string | number | undefined> = { limit: 50 }
      if (this.data.statusFilter) params.status = this.data.statusFilter
      const res = await getRecords(params)
      this.setData({
        records: res.items.map((r) => ({
          ...r,
          scoreLabel: r.score_total != null ? getScoreGrade(r.score_total) : undefined,
          timeLabel: formatDate(r.start_time),
        })),
        loading: false,
      })
    } catch {
      this.setData({ loading: false })
    }
  },

  filterRecords(e: WechatMiniprogram.TouchEvent) {
    const status = e.currentTarget.dataset.status || ""
    this.setData({ statusFilter: status }, () => this.loadRecords())
  },

  goToDetail(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id
    wx.navigateTo({ url: `/pages/record-detail/record-detail?id=${id}` })
  },

  continueRecord(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id
    wx.navigateTo({ url: `/pages/training/training?recordId=${id}` })
  },

  async handleDelete(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id
    const r = this.data.records.find((r) => r.id === id)
    if (!r) return
    wx.showModal({
      title: "删除记录",
      content: `确定删除「${r.case_name}」的训练记录吗？`,
      confirmColor: "#dc2626",
      success: async (res) => {
        if (!res.confirm) return
        try {
          await deleteRecord(id)
          wx.showToast({ title: "已删除", icon: "success" })
          this.loadRecords()
        } catch { /* toast already shown */ }
      },
    })
  },
})
