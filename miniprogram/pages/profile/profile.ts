import { getMe, updateMyProfile, wechatBind } from "../../api/auth"
import { changePassword } from "../../api/auth"
import { clearToken } from "../../utils/format"

const app = getApp<IAppOption>()

function getGenderEmoji(g?: string | null): string {
  if (g === "男") return "👨"
  if (g === "女") return "👩"
  return "👤"
}

Page({
  data: {
    displayName: "",
    roleLabel: "",
    gender: "" as string,
    genderEmoji: "👤",
    wechatBound: false,
    editMode: false,
    editName: "",
    editGender: "" as string,
    editSaving: false,
    pwdMode: false,
    oldPwd: "",
    newPwd: "",
    pwdSaving: false,
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
        gender: profile.gender || "",
        genderEmoji: getGenderEmoji(profile.gender),
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

  openEdit() {
    this.setData({
      editMode: true,
      editName: this.data.displayName,
      editGender: this.data.gender,
    })
  },

  cancelEdit() {
    this.setData({ editMode: false })
  },

  onEditName(e: WechatMiniprogram.Input) {
    this.setData({ editName: e.detail.value })
  },

  selectMale() {
    this.setData({ editGender: "男" })
  },

  selectFemale() {
    this.setData({ editGender: "女" })
  },

  onOldPwd(e: WechatMiniprogram.Input) {
    this.setData({ oldPwd: e.detail.value })
  },

  onNewPwd(e: WechatMiniprogram.Input) {
    this.setData({ newPwd: e.detail.value })
  },

  async saveEdit() {
    this.setData({ editSaving: true })
    try {
      await updateMyProfile({
        display_name: this.data.editName || null,
        gender: this.data.editGender || null,
      })
      wx.showToast({ title: "保存成功", icon: "success" })
      this.setData({ editMode: false })
      this.loadProfile()
    } catch (e) {
      wx.showToast({ title: "保存失败", icon: "none" })
    } finally {
      this.setData({ editSaving: false })
    }
  },

  openPwd() {
    this.setData({ pwdMode: true, oldPwd: "", newPwd: "" })
  },

  cancelPwd() {
    this.setData({ pwdMode: false })
  },

  async savePwd() {
    if (!this.data.oldPwd || !this.data.newPwd) {
      wx.showToast({ title: "请填写完整", icon: "none" })
      return
    }
    if (this.data.newPwd.length < 6) {
      wx.showToast({ title: "新密码至少6位", icon: "none" })
      return
    }
    this.setData({ pwdSaving: true })
    try {
      await changePassword(this.data.oldPwd, this.data.newPwd)
      wx.showToast({ title: "密码修改成功", icon: "success" })
      this.setData({ pwdMode: false })
    } catch (e) {
      wx.showToast({ title: "修改失败", icon: "none" })
    } finally {
      this.setData({ pwdSaving: false })
    }
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
