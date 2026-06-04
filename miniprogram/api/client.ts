function getApp_(): { globalData: { token: string; userId: number; role: string; baseUrl: string } } {
  return (getApp() as any) || { globalData: { token: "", userId: 0, role: "", baseUrl: "https://api.your-domain.com" } }
}

function getBaseUrl(): string {
  return getApp_().globalData.baseUrl || "https://api.your-domain.com"
}

function getToken(): string {
  return getApp_().globalData.token || wx.getStorageSync("access_token") || ""
}

let _redirecting = false
let _redirectTimer = 0

function redirectToLogin() {
  if (_redirecting) return
  _redirecting = true
  wx.removeStorageSync("access_token")
  wx.removeStorageSync("user_id")
  wx.removeStorageSync("role")
  const app = getApp_()
  app.globalData.token = ""
  clearTimeout(_redirectTimer)
  _redirectTimer = setTimeout(() => { _redirecting = false }, 2000) as unknown as number
  wx.reLaunch({ url: "/pages/login/login" })
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

  let url = `${getBaseUrl()}${path}`
  if (params) {
    const query = Object.entries(params)
      .filter(([, v]) => v !== undefined && v !== "")
      .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
      .join("&")
    if (query) url += `?${query}`
  }

  const token = getToken()

  return new Promise<T>((resolve, reject) => {
    wx.request({
      url,
      method,
      data,
      timeout,
      header: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      success(res: any) {
        if (showLoading) wx.hideLoading()
        if (res.statusCode === 401) {
          if (!token) {
            redirectToLogin()
            reject(new Error("unauthorized"))
            return
          }
          redirectToLogin()
          reject(new Error("unauthorized"))
          return
        }
        if (res.statusCode >= 400) {
          const detail = (res.data as { detail?: string })?.detail || "请求失败"
          wx.showToast({ title: detail, icon: "none", duration: 2500 })
          reject(new Error(detail))
          return
        }
        resolve(res.data as T)
      },
      fail(err: any) {
        if (showLoading) wx.hideLoading()
        if (err.errMsg?.includes("timeout")) {
          wx.showToast({ title: "请求超时，请重试", icon: "none" })
        } else {
          wx.showToast({ title: "网络错误，请检查网络", icon: "none" })
        }
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
