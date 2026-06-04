import { getRecordDetail, type TrainingRecordDetail, type ScoreData } from "../../api/training"
import { formatDate, getScoreGrade } from "../../utils/format"

Page({
  data: {
    record: null as TrainingRecordDetail | null,
    scoreGrade: null as { label: string; color: string } | null,
    loading: true,
  },

  onLoad(options: Record<string, string>) {
    const id = Number(options.id)
    this.loadDetail(id)
  },

  async loadDetail(id: number) {
    this.setData({ loading: true })
    try {
      const detail = await getRecordDetail(id)
      this.setData({
        record: detail,
        scoreGrade: detail.score ? getScoreGrade(detail.score.total_score) : null,
        loading: false,
      })
    } catch {
      this.setData({ loading: false })
    }
  },

  get categoryScores(): { name: string; score: number; max: number }[] {
    const detail = this.data.record
    if (!detail?.score?.detail_scores) return []
    return Object.entries(detail.score.detail_scores).map(([name, d]) => ({
      name,
      score: d.score || 0,
      max: d.max || 0,
    }))
  },

  get strengths(): string[] {
    return this.data.record?.score?.strengths || []
  },

  get weaknesses(): string[] {
    return this.data.record?.score?.weaknesses || []
  },
})
