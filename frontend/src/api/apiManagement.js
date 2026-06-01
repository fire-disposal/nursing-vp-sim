import { api } from "../api.js";

export function fetchSecrets() {
  return api.get("/admin/api/secrets");
}
export function createSecret(data) {
  return api.post("/admin/api/secrets", data);
}
export function updateSecret(id, data) {
  return api.put(`/admin/api/secrets/${id}`, data);
}
export function deleteSecret(id) {
  return api.delete(`/admin/api/secrets/${id}`);
}

export function fetchConfigs(purpose) {
  const params = {};
  if (purpose) params.purpose = purpose;
  return api.get("/admin/api/configs", { params });
}
export function createConfig(data) {
  return api.post("/admin/api/configs", data);
}
export function updateConfig(id, data) {
  return api.put(`/admin/api/configs/${id}`, data);
}
export function deleteConfig(id) {
  return api.delete(`/admin/api/configs/${id}`);
}
export function toggleConfig(id) {
  return api.post(`/admin/api/configs/${id}/toggle`);
}
export function resetConfig(id) {
  return api.post(`/admin/api/configs/${id}/reset`);
}
export function testConfig(id) {
  return api.post(`/admin/api/configs/${id}/test`);
}

export function testAllConfigs() {
  return api.post("/admin/api/configs/test-all");
}

export function reloadRouter() {
  return api.post("/admin/api/reload");
}
export function checkHealth() {
  return api.get("/admin/api/health");
}

export function fetchPrompts(purpose) {
  const params = {};
  if (purpose) params.purpose = purpose;
  return api.get("/admin/prompts", { params });
}
export function createPrompt(data) {
  return api.post("/admin/prompts", data);
}
export function updatePrompt(id, data) {
  return api.put(`/admin/prompts/${id}`, data);
}
export function deletePrompt(id) {
  return api.delete(`/admin/prompts/${id}`);
}
export function activatePrompt(id) {
  return api.post(`/admin/prompts/${id}/activate`);
}
export function validatePrompt(data) {
  return api.post("/admin/prompts/validate", data);
}
export function reloadPrompts() {
  return api.post("/admin/prompts/reload");
}
export function previewActivePrompt(purpose) {
  return api.get("/admin/prompts/active/preview", { params: { purpose } });
}
export function fetchSampleVars(purpose) {
  return api.get("/admin/prompts/sample-vars", { params: { purpose } });
}
