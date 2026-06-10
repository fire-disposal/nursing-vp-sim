import { request } from "./client"
import type { components } from "./types.gen"

type Schemas = components["schemas"]

export interface StudentAssignmentItem {
  id: string
  case_name: string
  class_name: string
  status: string
  start_time: string
  end_time: string
  score_total?: number
}

export function getStudentAssignments() {
  return request<{ items: StudentAssignmentItem[] }>({ url: "/students/assignments", method: "GET" })
}

export function startFromAssignment(assignmentId: string) {
  return request<{ record_id: number; greeting: string; case_name: string }>({
    url: `/training/start-from-assignment?assignment_id=${assignmentId}`,
    method: "POST",
  })
}
