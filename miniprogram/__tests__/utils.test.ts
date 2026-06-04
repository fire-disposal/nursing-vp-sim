import { formatTime, formatDate, getScoreGrade, getDifficultyLabel, setToken, getToken, clearToken } from "../utils/format"

describe("formatTime", () => {
  it("formats seconds to mm:ss", () => {
    expect(formatTime(0)).toBe("00:00")
    expect(formatTime(60)).toBe("01:00")
    expect(formatTime(125)).toBe("02:05")
    expect(formatTime(3600)).toBe("60:00")
  })

  it("returns --:-- for null", () => {
    expect(formatTime(null)).toBe("--:--")
  })
})

describe("formatDate", () => {
  it("formats ISO date to readable Chinese", () => {
    const result = formatDate("2025-01-15T10:30:00Z")
    expect(result).toContain("月")
    expect(result).toContain("日")
  })

  it("returns empty for empty input", () => {
    expect(formatDate("")).toBe("")
  })
})

describe("getScoreGrade", () => {
  it("returns 优秀 for >= 85", () => {
    expect(getScoreGrade(85).label).toBe("优秀")
    expect(getScoreGrade(100).color).toBe("#16a34a")
  })
  it("returns 良好 for >= 70", () => {
    expect(getScoreGrade(75).label).toBe("良好")
  })
  it("returns 及格 for >= 60", () => {
    expect(getScoreGrade(65).label).toBe("及格")
  })
  it("returns 待提升 for < 60", () => {
    expect(getScoreGrade(40).label).toBe("待提升")
    expect(getScoreGrade(0).color).toBe("#dc2626")
  })
})

describe("getDifficultyLabel", () => {
  it("returns 初级 for 1", () => expect(getDifficultyLabel(1)).toBe("初级"))
  it("returns 中级 for 2", () => expect(getDifficultyLabel(2)).toBe("中级"))
  it("returns 高级 for 3", () => expect(getDifficultyLabel(3)).toBe("高级"))
  it("returns empty for unknown", () => expect(getDifficultyLabel(0)).toBe(""))
})

describe("storage utils", () => {
  beforeEach(() => {
    wx.clearStorageSync()
  })

  it("set/get/clear token", () => {
    setToken("test-token")
    expect(getToken()).toBe("test-token")
    clearToken()
    expect(getToken()).toBe("")
  })
})
