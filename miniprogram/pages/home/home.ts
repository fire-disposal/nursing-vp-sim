import { getDurationStats, getTrends } from "../../api/stats"
import { getMe } from "../../api/auth"
import { getRecords, startTraining } from "../../api/training"
import type { CaseBrief } from "../../api/cases"
import { getCases } from "../../api/cases"
import { formatDate, getScoreGrade } from "../../utils/format"

Page({
  data: {
    userName: "",
    totalSessions: 0,
    totalMinutes: 0,
    avgScore: 0,
    recentRecords: [] as Record<string, unknown>[],
    recommendedCases: [] as CaseBrief[],
    loading: true,
    latestScore: null as { total: number; details: Record<string, { score: number; max: number }> } | null,
    weeklyTrend: [] as { label: string; value: number; height: number }[],
    weeklyMax: 0,
  },

  onShow() {
    this.loadData()
  },

  async loadData() {
    this.setData({ loading: true })
    try {
      const [duration, trends, cases, records, me] = await Promise.all([
        getDurationStats("month").catch(() => null),
        getTrends("week").catch(() => null),
        getCases({ limit: 5 }).catch(() => null),
        getRecords({ limit: 1, status: "completed" }).catch(() => null),
        getMe().catch(() => null),
      ])

      let latestScore = null
      if (records?.items?.[0]) {
        const r = records.items[0]
        const detailScores = r.score_total != null ? { score: r.score_total as number, max: 100 } : null
        if (detailScores) {
          latestScore = { total: detailScores.score, details: {} }
        }
      }

      const weekDays = ["日", "一", "二", "三", "四", "五", "六"]
      const daily = (trends as Record<string, unknown>)?.daily as Array<{ sessions: number }> | undefined
      const weeklyTrend = daily?.slice(-7).map((d: { sessions: number }, i: number) => {
        const dayIdx = (new Date().getDay() - (6 - i) + 7) % 7
        return { label: weekDays[dayIdx], value: d.sessions, height: 0 }
      }) || []
      const weeklyMax = Math.max(...weeklyTrend.map((d) => d.value), 1)
      weeklyTrend.forEach((d) => { d.height = Math.max((d.value / weeklyMax) * 100, 8) })

      this.setData({
        userName: me?.display_name || "",
        totalSessions: duration?.total_sessions ?? 0,
        totalMinutes: duration?.total_minutes ?? 0,
        avgScore: trends?.avg_score ?? 0,
        recommendedCases: cases?.items?.slice(0, 3) ?? [],
        recentRecords: (records?.items ?? []).slice(0, 5).map((r: Record<string, unknown>) => ({
          ...r,
          scoreLabel: r.score_total != null ? getScoreGrade(r.score_total as number) : null,
          timeLabel: formatDate(r.start_time as string),
        })),
        latestScore,
        weeklyTrend,
        weeklyMax,
        loading: false,
      })
    } catch {
      this.setData({ loading: false })
    }
  },

  goToCases() {
    wx.switchTab({ url: "/pages/cases/cases" })
  },

  goToQA() {
    wx.navigateTo({ url: "/pages/qa/qa" })
  },

  goToRecord(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id
    wx.navigateTo({ url: `/pages/record-detail/record-detail?id=${id}` })
  },

  continueRecord(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id
    wx.navigateTo({ url: `/pages/training/training?recordId=${id}` })
  },

  async startFromCase(e: WechatMiniprogram.TouchEvent) {
    const caseId = Number(e.currentTarget.dataset.id)
    if (!caseId) return
    try {
      const res = await startTraining({ case_id: caseId })
      wx.navigateTo({
        url: `/pages/training/training?recordId=${res.record_id}&caseName=${encodeURIComponent(res.case_name)}&greeting=${encodeURIComponent(res.greeting)}`,
      })
    } catch {
      wx.showToast({ title: "启动训练失败", icon: "none" })
    }
  },
})
