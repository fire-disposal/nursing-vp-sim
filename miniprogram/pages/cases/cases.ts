import { getCases, type CaseBrief } from "../../api/cases"
import { startTraining } from "../../api/training"

Page({
  data: {
    cases: [] as CaseBrief[],
    difficulty: 0,
    loading: true,
    startingId: 0,
  },

  onShow() {
    this.loadCases()
  },

  async onPullDownRefresh() {
    await this.loadCases()
    wx.stopPullDownRefresh()
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
    if (this.data.startingId) return
    this.setData({ startingId: caseId })
    try {
      const res = await startTraining({ case_id: caseId })
      wx.redirectTo({
        url: `/pages/training/training?recordId=${res.record_id}&caseName=${encodeURIComponent(res.case_name)}&greeting=${encodeURIComponent(res.greeting)}`,
      })
    } catch {
      this.setData({ startingId: 0 })
    }
  },

  getPatientLabel(patient: CaseBrief["patient_summary"]): string {
    if (!patient) return ""
    const parts = []
    if (patient.name) parts.push(patient.name)
    if (patient.gender) parts.push(patient.gender)
    if (patient.age != null) parts.push(`${patient.age}岁`)
    return parts.join(" · ")
  },
})
