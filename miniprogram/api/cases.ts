import { get } from "./client"

export interface PatientSummary {
  name?: string
  age?: number
  gender?: string
}

export interface CaseBrief {
  id: number
  name: string
  difficulty: number
  description: string
  patient_summary: PatientSummary | null
}

export interface PaginatedResponse<T> {
  items: T[]
  total: number
  offset: number
  limit: number
}

export function getCases(params?: { offset?: number; limit?: number }) {
  return get<PaginatedResponse<CaseBrief>>("/api/cases", params as Record<string, string | number | undefined>)
}
