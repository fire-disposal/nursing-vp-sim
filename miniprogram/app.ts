App<IAppOption>({
  globalData: {
    token: "",
    userId: 0,
    role: "",
    // 本地开发用 localhost，上线前改为正式域名 https://api.your-domain.com
    baseUrl: "http://localhost:8000",
  },

  onLaunch() {
    const token = wx.getStorageSync("access_token")
    const userId = wx.getStorageSync("user_id")
    const role = wx.getStorageSync("role")
    if (token) {
      this.globalData.token = token
      this.globalData.userId = userId
      this.globalData.role = role
    }
  },
})
