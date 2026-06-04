// @ts-nocheck
const storage = {}

const mockWx = {
  request: jest.fn(),
  showToast: jest.fn(),
  showLoading: jest.fn(),
  hideLoading: jest.fn(),
  showModal: jest.fn(),
  navigateTo: jest.fn(),
  redirectTo: jest.fn(),
  reLaunch: jest.fn(),
  setStorageSync: jest.fn((key, val) => { storage[key] = val }),
  getStorageSync: jest.fn((key) => storage[key] || ""),
  removeStorageSync: jest.fn((key) => { delete storage[key] }),
  clearStorageSync: jest.fn(() => { Object.keys(storage).forEach((k) => delete storage[k]) }),
}

const mockGlobalData = {
  token: "",
  userId: 0,
  role: "",
  baseUrl: "https://api.test.com",
}

globalThis.wx = mockWx
globalThis.getApp = () => ({ globalData: mockGlobalData })

