import { getDurationStats, getTrends } from "../../api/stats"
import { getMe } from "../../api/auth"
import { getRecords } from "../../api/training"
import type { CaseBrief } from "../../api/cases"
import { getCases } from "../../api/cases"
import { formatDate, formatTime, getDifficultyLabel, getScoreGrade } from "../../utils/format"

Page({
  data: {
    userName: "",
    totalSessions: 0,
    totalMinutes: 0,
    avgScore: 0,
    inProgress: 0,
    recentRecords: [] as Record<string, unknown>[],
    recommendedCases: [] as CaseBrief[],
    loading: true,
  },

  onShow() {
    this.loadData()
  },

  async loadData() {
    this.setData({ loading: true })
    try {
      const [duration, trends, cases, records, me] = await Promise.all([
        getDurationStats("month").catch(() => null),
        getTrends("month").catch(() => null),
        getCases({ limit: 5 }).catch(() => null),
        getRecords({ limit: 5 }).catch(() => null),
        getMe().catch(() => null),
      ])

      this.setData({
        userName: me?.display_name || "",
        totalSessions: duration?.total_sessions ?? 0,
        totalMinutes: duration?.total_minutes ?? 0,
        avgScore: trends?.avg_score ?? 0,
        recommendedCases: cases?.items?.slice(0, 3) ?? [],
        recentRecords: (records?.items ?? []).map((r: Record<string, unknown>) => ({
          ...r,
          scoreLabel: r.score_total != null ? getScoreGrade(r.score_total as number) : null,
          timeLabel: formatDate(r.start_time as string),
        })),
        loading: false,
      })
    } catch {
      this.setData({ loading: false })
    }
  },

  goToCases() {
    wx.navigateTo({ url: "/pages/cases/cases" })
  },

  goToRecord(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id
    wx.navigateTo({ url: `/pages/record-detail/record-detail?id=${id}` })
  },

  continueRecord(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id
    wx.navigateTo({ url: `/pages/training/training?recordId=${id}` })
  },
})
