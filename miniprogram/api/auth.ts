import { get, post, request } from "./client"

export interface LoginRequest {
  username: string
  password: string
}

export interface LoginResponse {
  access_token: string
  token_type: string
  role: string
  display_name: string
  user_id: number
  gender?: string | null
  avatar?: string | null
}

export interface UserProfile {
  id: number
  username: string
  role: string
  role_display_name: string
  display_name: string
  student_id: string | null
  gender?: string | null
  avatar?: string | null
  class_id: number | null
  created_at: string
}

export interface WechatLoginResponse {
  access_token: string | null
  token_type: string
  role: string | null
  display_name: string | null
  user_id: number | null
  need_bind: boolean
}

export interface WechatRegisterRequest {
  code: string
  display_name: string
}

export function login(data: LoginRequest) {
  return post<LoginResponse>("/api/auth/login", data as unknown as Record<string, unknown>)
}

export function getMe() {
  return get<UserProfile>("/api/auth/me")
}

export function wechatLogin(code: string) {
  return post<WechatLoginResponse>("/api/auth/wechat/login", { code } as unknown as Record<string, unknown>)
}

export function wechatBind(code: string) {
  return post<{ ok: boolean }>("/api/auth/wechat/bind", { code } as unknown as Record<string, unknown>)
}

export function wechatRegister(data: WechatRegisterRequest) {
  return post<LoginResponse>("/api/auth/wechat/register", data as unknown as Record<string, unknown>)
}

export function refreshToken() {
  return post<LoginResponse>("/api/auth/refresh")
}

export function changePassword(oldPassword: string, newPassword: string) {
  return request<{ ok: boolean; message: string }>("PUT", "/api/auth/change-password", { old_password: oldPassword, new_password: newPassword } as unknown as Record<string, unknown>)
}

export function updateMyProfile(data: {
  display_name?: string | null
  student_id?: string | null
  gender?: string | null
  avatar?: string | null
}) {
  return request<UserProfile>("PUT", "/api/auth/me", data as unknown as Record<string, unknown>)
}
