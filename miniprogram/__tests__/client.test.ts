import "../__tests__/setup"
import { request, get, post } from "../api/client"

describe("API client", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.useFakeTimers()
    const app = getApp()
    app.globalData.token = ""
    app.globalData.baseUrl = "https://api.test.com"
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  describe("request", () => {
    it("sends GET with auth header when token exists", async () => {
      const app = getApp()
      app.globalData.token = "valid-token";
      (wx.request as jest.Mock).mockImplementation((opts: any) => {
        opts.success({ statusCode: 200, data: { result: "ok" } })
      })

      const result = await request("GET", "/api/cases")
      expect(result).toEqual({ result: "ok" })
      expect(wx.request).toHaveBeenCalledWith(
        expect.objectContaining({
          url: "https://api.test.com/api/cases",
          method: "GET",
          header: expect.objectContaining({ Authorization: "Bearer valid-token" }),
        })
      )
    })

    it("sends POST with JSON body", async () => {
      (wx.request as jest.Mock).mockImplementation((opts: any) => {
        opts.success({ statusCode: 200, data: { id: 1 } })
      })

      await request("POST", "/api/training/start", { case_id: 5 })
      expect(wx.request).toHaveBeenCalledWith(
        expect.objectContaining({
          method: "POST",
          data: { case_id: 5 },
        })
      )
    })

    it("rejects 401 responses", async () => {
      (wx.request as jest.Mock).mockImplementation((opts: any) => {
        opts.success({ statusCode: 401, data: {} })
      })

      await expect(request("GET", "/api/auth/me")).rejects.toThrow()
      expect(wx.reLaunch).toHaveBeenCalledWith({ url: "/pages/login/login" })
    })

    it("handles network failure with toast", async () => {
      (wx.request as jest.Mock).mockImplementation((opts: any) => {
        opts.fail({ errMsg: "request:fail" })
      })

      await expect(request("GET", "/api/test")).rejects.toBeDefined()
      expect(wx.showToast).toHaveBeenCalled()
    })

    it("shows error detail on 4xx", async () => {
      (wx.request as jest.Mock).mockImplementation((opts: any) => {
        opts.success({ statusCode: 400, data: { detail: "参数错误" } })
      })

      await expect(request("POST", "/api/test")).rejects.toThrow("参数错误")
    })
  })

  describe("convenience functions", () => {
    it("get adds query params", async () => {
      (wx.request as jest.Mock).mockImplementation((opts: any) => {
        opts.success({ statusCode: 200, data: [] })
      })

      await get("/api/cases", { limit: 10, offset: 0 })
      expect((wx.request as jest.Mock).mock.calls[0][0].url).toContain("limit=10")
      expect((wx.request as jest.Mock).mock.calls[0][0].url).toContain("offset=0")
    })

    it("post sends body", async () => {
      (wx.request as jest.Mock).mockImplementation((opts: any) => {
        opts.success({ statusCode: 200, data: {} })
      })

      await post("/api/auth/login", { username: "test", password: "123" })
      expect((wx.request as jest.Mock).mock.calls[0][0].data).toEqual({ username: "test", password: "123" })
    })
  })
})
