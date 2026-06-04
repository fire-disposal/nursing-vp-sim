const app = getApp<IAppOption>()

const BASE_URL = app.globalData.baseUrl

function getToken(): string {
  return app.globalData.token || wx.getStorageSync("access_token") || ""
}

interface RequestOptions {
  showLoading?: boolean
  timeout?: number
}

export function request<T>(
  method: "GET" | "POST" | "PUT" | "DELETE",
  path: string,
  data?: Record<string, unknown>,
  params?: Record<string, string | number | undefined>,
  options: RequestOptions = {},
): Promise<T> {
  const { showLoading = false, timeout = 120000 } = options

  if (showLoading) {
    wx.showLoading({ title: "加载中...", mask: true })
  }

  let url = `${BASE_URL}${path}`
  if (params) {
    const query = Object.entries(params)
      .filter(([, v]) => v !== undefined && v !== "")
      .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
      .join("&")
    if (query) url += `?${query}`
  }

  return new Promise<T>((resolve, reject) => {
    wx.request({
      url,
      method,
      data,
      timeout,
      header: {
        "Content-Type": "application/json",
        ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}),
      },
      success(res) {
        if (showLoading) wx.hideLoading()
        if (res.statusCode === 401) {
          wx.removeStorageSync("access_token")
          wx.removeStorageSync("user_id")
          wx.removeStorageSync("role")
          app.globalData.token = ""
          wx.reLaunch({ url: "/pages/login/login" })
          reject(new Error("unauthorized"))
          return
        }
        if (res.statusCode >= 400) {
          const detail = (res.data as { detail?: string })?.detail || "请求失败"
          wx.showToast({ title: detail, icon: "none" })
          reject(new Error(detail))
          return
        }
        resolve(res.data as T)
      },
      fail(err) {
        if (showLoading) wx.hideLoading()
        wx.showToast({ title: "网络错误，请重试", icon: "none" })
        reject(err)
      },
    })
  })
}

export function get<T>(path: string, params?: Record<string, string | number | undefined>, opts?: RequestOptions) {
  return request<T>("GET", path, undefined, params, opts)
}

export function post<T>(path: string, data?: Record<string, unknown>, opts?: RequestOptions) {
  return request<T>("POST", path, data, undefined, opts)
}
