App<IAppOption>({
  globalData: {
    token: "",
    userId: 0,
    role: "",
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
