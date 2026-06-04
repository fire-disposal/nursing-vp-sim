import { get } from "./client"

export interface DurationStats {
  daily: { date: string; minutes: number }[]
  total_minutes: number
  total_sessions: number
}

export interface TrendDay {
  date: string
  sessions: number
  minutes: number
  avg_score: number | null
}

export interface TrendStats {
  daily: TrendDay[]
  total_sessions: number
  total_minutes: number
  avg_score: number | null
}

export function getDurationStats(period: string = "month") {
  return get<DurationStats>("/api/stats/duration", { period })
}

export function getTrends(period: string = "month") {
  return get<TrendStats>("/api/stats/trends", { period })
}
