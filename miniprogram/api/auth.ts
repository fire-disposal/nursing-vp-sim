import { get, post } from "./client"

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
}

export interface UserProfile {
  id: number
  username: string
  role: string
  display_name: string
  student_id: string | null
  class_id: number | null
  created_at: string
}

export function login(data: LoginRequest) {
  return post<LoginResponse>("/api/auth/login", data as unknown as Record<string, unknown>)
}

export function getMe() {
  return get<UserProfile>("/api/auth/me")
}
