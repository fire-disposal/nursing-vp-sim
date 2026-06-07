import { getMe, wechatBind } from "../../api/auth"
import { clearToken } from "../../utils/format"

const app = getApp<IAppOption>()

Page({
  data: {
    displayName: "",
    roleLabel: "",
    userInitial: "👤",
    wechatBound: false,
  },

  onShow() {
    this.loadProfile()
  },

  async loadProfile() {
    try {
      const profile = await getMe()
      this.setData({
        displayName: profile.display_name,
        roleLabel: profile.role === "teacher" ? "教师" : "学生",
        userInitial: profile.display_name?.charAt(0) || "👤",
      })
    } catch { /* ignore */ }

    this.checkWechatBound()
  },

  checkWechatBound() {
    wx.login({
      success: async (loginRes) => {
        try {
          const { wechatLogin } = await import("../../api/auth")
          const res = await wechatLogin(loginRes.code)
          this.setData({ wechatBound: !res.need_bind })
        } catch { /* ignore */ }
      },
    })
  },

  async handleWechatBind() {
    if (this.data.wechatBound) return

    const loginRes = await new Promise<WechatMiniprogram.LoginSuccessCallbackResult>((resolve, reject) => {
      wx.login({ success: resolve as WechatMiniprogram.LoginSuccessCallback, fail: reject })
    })

    try {
      await wechatBind(loginRes.code)
      wx.showToast({ title: "绑定成功", icon: "success" })
      this.setData({ wechatBound: true })
    } catch (e) {
      const msg = typeof e === "string" ? e : (e as Error)?.message || "绑定失败"
      wx.showToast({ title: msg, icon: "none" })
    }
  },

  goToStats() {
    wx.switchTab({ url: "/pages/history/history" })
  },

  goToFeedback() {
    wx.navigateTo({ url: "/pages/feedback/feedback" })
  },

  goToMyResponses() {
    wx.navigateTo({ url: "/pages/my-responses/my-responses" })
  },

  goToQA() {
    wx.navigateTo({ url: "/pages/qa/qa" })
  },

  goToAbout() {
    wx.showModal({
      title: "关于我们",
      content: "虚拟患者训练系统\n护理病史采集技能训练平台\n版本: v1.0.0",
      showCancel: false,
    })
  },

  handleLogout() {
    wx.showModal({
      title: "退出登录",
      content: "确定要退出当前账号吗？",
      confirmColor: "#dc2626",
      success: (res) => {
        if (!res.confirm) return
        clearToken()
        app.globalData.token = ""
        app.globalData.userId = 0
        app.globalData.role = ""
        wx.reLaunch({ url: "/pages/login/login" })
      },
    })
  },
})
