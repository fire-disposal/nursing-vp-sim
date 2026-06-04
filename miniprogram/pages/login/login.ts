import { login, wechatLogin, wechatRegister } from "../../api/auth"
import { setToken } from "../../utils/format"

const app = getApp<IAppOption>()

Page({
  data: {
    mode: "wechat" as "wechat" | "account",
    username: "",
    password: "",
    loading: false,
    error: "",
  },

  switchMode() {
    this.setData({
      mode: this.data.mode === "wechat" ? "account" : "wechat",
      error: "",
    })
  },

  onUsernameInput(e: WechatMiniprogram.Input) {
    this.setData({ username: e.detail.value, error: "" })
  },

  onPasswordInput(e: WechatMiniprogram.Input) {
    this.setData({ password: e.detail.value, error: "" })
  },

  async handleWechatLogin() {
    this.setData({ loading: true, error: "" })
    try {
      const loginRes = await new Promise<WechatMiniprogram.LoginSuccessCallbackResult>((resolve, reject) => {
        wx.login({ success: resolve as WechatMiniprogram.LoginSuccessCallback, fail: reject })
      })

      const res = await wechatLogin(loginRes.code)

      if (res.need_bind) {
        this.showNicknamePrompt(loginRes.code)
        return
      }

      if (!res.access_token) {
        this.setData({ error: "微信登录失败" })
        return
      }

      this.saveAndGo(res.access_token, res.role || "student", res.user_id || 0)
    } catch (e) {
      this.setData({ error: (e as Error).message || "微信登录失败" })
    } finally {
      this.setData({ loading: false })
    }
  },

  showNicknamePrompt(code: string) {
    wx.showModal({
      title: "设置昵称",
      editable: true,
      placeholderText: "请输入你的昵称",
      success: async (res) => {
        if (!res.confirm || !res.content?.trim()) {
          this.setData({ loading: false, error: "昵称不能为空" })
          return
        }
        try {
          const regRes = await wechatRegister({ code, display_name: res.content.trim() })
          this.saveAndGo(regRes.access_token, regRes.role, regRes.user_id)
        } catch (e) {
          this.setData({ loading: false, error: (e as Error).message || "注册失败" })
        }
      },
      fail: () => {
        this.setData({ loading: false })
      },
    })
  },

  async handleLogin() {
    const { username, password } = this.data
    if (!username.trim() || !password.trim()) {
      this.setData({ error: "请输入用户名和密码" })
      return
    }

    this.setData({ loading: true, error: "" })
    try {
      const res = await login({ username: username.trim(), password })
      this.saveAndGo(res.access_token, res.role, res.user_id)
    } catch (e) {
      this.setData({ error: (e as Error).message || "登录失败" })
    } finally {
      this.setData({ loading: false })
    }
  },

  saveAndGo(token: string, role: string, userId: number) {
    setToken(token)
    wx.setStorageSync("user_id", userId)
    wx.setStorageSync("role", role)
    app.globalData.token = token
    app.globalData.userId = userId
    app.globalData.role = role
    wx.switchTab({ url: "/pages/home/home" })
  },
})
