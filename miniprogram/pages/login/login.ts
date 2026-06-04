import { login } from "../../api/auth"
import { setToken } from "../../utils/format"

const app = getApp<IAppOption>()

Page({
  data: {
    username: "",
    password: "",
    loading: false,
    error: "",
  },

  onUsernameInput(e: WechatMiniprogram.Input) {
    this.setData({ username: e.detail.value, error: "" })
  },

  onPasswordInput(e: WechatMiniprogram.Input) {
    this.setData({ password: e.detail.value, error: "" })
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
      setToken(res.access_token)
      wx.setStorageSync("user_id", res.user_id)
      wx.setStorageSync("role", res.role)
      app.globalData.token = res.access_token
      app.globalData.userId = res.user_id
      app.globalData.role = res.role
      wx.reLaunch({ url: "/pages/home/home" })
    } catch (e) {
      this.setData({ error: (e as Error).message || "登录失败" })
    } finally {
      this.setData({ loading: false })
    }
  },
})
