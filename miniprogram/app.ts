App<IAppOption>({
  globalData: {
    token: "",
    userId: 0,
    role: "",
    // 本地开发（调试时使用，另两个注释掉）
    baseUrl: "http://localhost:8000",
    // 测试服务器（test.205716.xyz → 127.0.0.1:9080）
    // baseUrl: "https://test.205716.xyz",
    // 正式服务器（iomt.205716.xyz → 127.0.0.1:9000）
    // baseUrl: "https://iomt.205716.xyz",
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
