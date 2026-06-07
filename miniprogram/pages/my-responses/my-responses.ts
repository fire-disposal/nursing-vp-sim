import { request } from "../../api/client"

interface ResponseItem {
  id: number
  template_id: number
  template_title: string
  status: string
  completed_at: string | null
  created_at: string
  answers: AnswerItem[]
}

interface AnswerItem {
  question_id: number
  question_content: string
  question_type: string
  options: string[] | null
  answer_value: string | null
}

interface ResponsesPage {
  items: ResponseItem[]
  total: number
}

Page({
  data: {
    loading: true,
    responses: [] as ResponseItem[],
    total: 0,
    detailResponse: null as ResponseItem | null,
    offset: 0,
    limit: 20,
    likertLabels: ["非常不同意", "不同意", "一般", "同意", "非常同意"],
  },

  onLoad() {
    this.loadResponses()
  },

  async loadResponses() {
    this.setData({ loading: true })
    try {
      const resp = await request<ResponsesPage>("GET", "/api/questionnaires/my-responses", undefined, {
        offset: this.data.offset,
        limit: this.data.limit,
      })
      this.setData({ responses: resp.items || [], total: resp.total || 0, loading: false })
    } catch {
      this.setData({ loading: false })
      wx.showToast({ title: "加载失败", icon: "none" })
    }
  },

  onLoadMore() {
    if (this.data.responses.length >= this.data.total) return
    this.setData({ offset: this.data.offset + this.data.limit })
    this.loadResponses()
  },

  onViewDetail(e: WechatMiniprogram.BaseEvent) {
    const resp = e.currentTarget.dataset.response as ResponseItem
    this.setData({ detailResponse: resp })
  },

  onCloseDetail() {
    this.setData({ detailResponse: null })
  },
})
