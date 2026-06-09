import { api } from "@/api/axios-instance";

export interface ScenarioConfigResponse {
  id: string;
  name: string;
  phases: Array<{ id: string; order: number }>;
  features: Record<string, boolean>;
  scoring: { rubric_id: string; auto_delay_seconds: number };
  layout?: any;
  frontend_plugins: string[];
  backend_plugins: string[];
  default_duration: number;
}

export function fetchScenarios(): Promise<ScenarioConfigResponse[]> {
  return api.get("/training/scenarios").then((r) => r.data as ScenarioConfigResponse[]);
}

export function fetchScenario(id: string): Promise<ScenarioConfigResponse> {
  return api.get(`/training/scenarios/${id}`).then((r) => r.data as ScenarioConfigResponse);
}

export function fetchRecordScenario(recordId: string): Promise<ScenarioConfigResponse> {
  return api.get(`/training/records/${recordId}/scenario`).then((r) => r.data as ScenarioConfigResponse);
}
