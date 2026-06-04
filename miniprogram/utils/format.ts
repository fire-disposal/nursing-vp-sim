export function getToken(): string {
  return wx.getStorageSync("access_token") || ""
}

export function setToken(token: string) {
  wx.setStorageSync("access_token", token)
}

export function clearToken() {
  wx.removeStorageSync("access_token")
  wx.removeStorageSync("user_id")
  wx.removeStorageSync("role")
}

export function getUserId(): number {
  return wx.getStorageSync("user_id") || 0
}

export function formatTime(seconds: number | null): string {
  if (seconds == null) return "--:--"
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
}

export function formatDate(dateStr: string): string {
  if (!dateStr) return ""
  const d = new Date(dateStr)
  const m = d.getMonth() + 1
  const day = d.getDate()
  const h = d.getHours()
  const min = d.getMinutes()
  return `${m}月${day}日 ${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`
}

export function getScoreGrade(score: number): { label: string; color: string } {
  if (score >= 85) return { label: "优秀", color: "#16a34a" }
  if (score >= 70) return { label: "良好", color: "#2563eb" }
  if (score >= 60) return { label: "及格", color: "#d97706" }
  return { label: "待提升", color: "#dc2626" }
}

export function getDifficultyLabel(d: number): string {
  if (d === 1) return "初级"
  if (d === 2) return "中级"
  if (d === 3) return "高级"
  return ""
}

export function getDifficultyStars(d: number): string {
  if (d === 1) return "★☆☆"
  if (d === 2) return "★★☆"
  if (d === 3) return "★★★"
  return ""
}
