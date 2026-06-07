import { request } from "../../api/client"

interface CheckResponse {
  has_pending: boolean
  template_id?: number
  response_id?: number
  template?: TemplateDetail
  is_required: boolean
  trigger_event: string
}

interface TemplateDetail {
  id: number
  title: string
  description?: string
  questions: QuestionItem[]
}

interface QuestionItem {
  id: number
  content: string
  question_type: string
  required: boolean
  sort_order: number
  options?: string[]
}

interface PageData {
  loading: boolean
  submitting: boolean
  error: string
  caseId: number | null
  checkResponse: CheckResponse | null
  answers: Record<number, string | null>
}

Page<PageData>({
  data: {
    loading: true,
    submitting: false,
    error: "",
    caseId: null,
    checkResponse: null,
    answers: {},
  },

  onLoad(options: Record<string, string | undefined>) {
    const caseId = options.caseId ? parseInt(options.caseId, 10) : null
    const trigger = options.trigger || "before_training"

    if (!caseId) {
      this.setData({ loading: false, error: "缺少参数" })
      return
    }

    this.setData({ caseId })

    request<CheckResponse>("GET", "/api/questionnaires/check", undefined, { case_id: caseId, trigger })
      .then((resp) => {
        if (resp.has_pending) {
          this.setData({ checkResponse: resp, loading: false })
        } else {
          wx.navigateBack({ fail: () => wx.switchTab({ url: "/pages/home/home" }) })
        }
      })
      .catch(() => {
        this.setData({ loading: false, error: "加载失败，请检查网络" })
      })
  },

  onAnswer(e: WechatMiniprogram.BaseEvent) {
    const { questionId, value } = e.currentTarget.dataset
    this.setData({
      answers: { ...this.data.answers, [questionId]: value },
      error: "",
    })
  },

  onTextInput(e: WechatMiniprogram.Input) {
    const questionId = parseInt(e.currentTarget.dataset.questionId, 10)
    this.setData({
      answers: { ...this.data.answers, [questionId]: e.detail.value || null },
      error: "",
    })
  },

  onSubmit() {
    const checkResponse = this.data.checkResponse
    if (!checkResponse?.template) return

    const questions = checkResponse.template.questions || []
    const answers = this.data.answers
    const missing = questions.filter((q) => q.required && !answers[q.id])
    if (missing.length > 0) {
      this.setData({ error: `请完成所有必答题（${missing.length} 题未答）` })
      return
    }

    this.setData({ submitting: true, error: "" })

    const answerList = questions.map((q) => ({
      question_id: q.id,
      answer_value: answers[q.id] ?? null,
    }))

    request("POST", "/api/questionnaires/responses", {
      template_id: checkResponse.template_id,
      case_id: this.data.caseId,
      answers: answerList,
    } as unknown as Record<string, unknown>)
      .then(() => {
        wx.navigateBack({ fail: () => wx.switchTab({ url: "/pages/home/home" }) })
      })
      .catch(() => {
        this.setData({ submitting: false, error: "提交失败，请重试" })
      })
  },

  onSkip() {
    wx.navigateBack({ fail: () => wx.switchTab({ url: "/pages/home/home" }) })
  },

  goBack() {
    wx.navigateBack({ fail: () => wx.switchTab({ url: "/pages/home/home" }) })
  },
})
