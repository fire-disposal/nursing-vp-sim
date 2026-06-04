import { getCases, type CaseBrief } from "../../api/cases"
import { startTraining } from "../../api/training"
import { getDifficultyLabel, getDifficultyStars } from "../../utils/format"

Page({
  data: {
    cases: [] as CaseBrief[],
    difficulty: 0,
    loading: true,
    starting: false,
  },

  onShow() {
    this.loadCases()
  },

  async loadCases() {
    this.setData({ loading: true })
    try {
      const res = await getCases({ limit: 50 })
      this.setData({ cases: res.items, loading: false })
    } catch {
      this.setData({ loading: false })
    }
  },

  filterCases(e: WechatMiniprogram.TouchEvent) {
    const d = Number(e.currentTarget.dataset.difficulty || 0)
    this.setData({ difficulty: d })
  },

  get filteredCases() {
    const d = this.data.difficulty
    if (d === 0) return this.data.cases
    return this.data.cases.filter((c) => c.difficulty === d)
  },

  async startCase(e: WechatMiniprogram.TouchEvent) {
    const caseId = Number(e.currentTarget.dataset.id)
    if (this.data.starting) return
    this.setData({ starting: true })
    try {
      const res = await startTraining({ case_id: caseId })
      wx.redirectTo({
        url: `/pages/training/training?recordId=${res.record_id}&caseName=${encodeURIComponent(res.case_name)}&greeting=${encodeURIComponent(res.greeting)}`,
      })
    } catch {
      this.setData({ starting: false })
    }
  },
})
