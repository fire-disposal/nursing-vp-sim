App<IAppOption>({
  globalData: {
    token: "",
    userId: 0,
    role: "",
    // 本地开发（调试时取消注释下一行，并注释正式地址）
    baseUrl: "http://localhost:8000",
    // 正式上线（上传前取消注释下一行，并注释本地地址）
    // baseUrl: "https://api.your-domain.com",
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
