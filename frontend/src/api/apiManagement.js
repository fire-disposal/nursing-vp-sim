import { api } from "../api.js";

export function fetchProviders() {
  return api.get("/admin/api/providers");
}
export function createProvider(data) {
  return api.post("/admin/api/providers", data);
}
export function updateProvider(id, data) {
  return api.put(`/admin/api/providers/${id}`, data);
}
export function deleteProvider(id) {
  return api.delete(`/admin/api/providers/${id}`);
}
export function fetchKeys(providerId, status) {
  const params = {};
  if (providerId) params.provider_id = providerId;
  if (status) params.status = status;
  return api.get("/admin/api/keys", { params });
}
export function createKey(data) {
  return api.post("/admin/api/keys", data);
}
export function createDeepseekKey(rawKey, label) {
  const params = { raw_key: rawKey };
  if (label) params.label = label;
  return api.post("/admin/api/keys/deepseek", null, { params });
}
export function updateKey(id, data) {
  return api.put(`/admin/api/keys/${id}`, data);
}
export function deleteKey(id) {
  return api.delete(`/admin/api/keys/${id}`);
}
export function resetKey(id) {
  return api.post(`/admin/api/keys/${id}/reset`);
}
export function testKey(id) {
  return api.post(`/admin/api/keys/${id}/test`);
}
export function fetchKeyStats(id) {
  return api.get(`/admin/api/keys/${id}/stats`);
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
