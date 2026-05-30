import { api } from "../api.js";

export function fetchProviders() { return api.get("/admin/api/providers"); }
export function createProvider(data) { return api.post("/admin/api/providers", data); }
export function updateProvider(id, data) { return api.put(`/admin/api/providers/${id}`, data); }
export function deleteProvider(id) { return api.delete(`/admin/api/providers/${id}`); }
export function fetchKeys(providerId, status) {
  const params = {};
  if (providerId) params.provider_id = providerId;
  if (status) params.status = status;
  return api.get("/admin/api/keys", { params });
}
export function createKey(data) { return api.post("/admin/api/keys", data); }
export function updateKey(id, data) { return api.put(`/admin/api/keys/${id}`, data); }
export function deleteKey(id) { return api.delete(`/admin/api/keys/${id}`); }
export function resetKey(id) { return api.post(`/admin/api/keys/${id}/reset`); }
export function fetchKeyStats(id) { return api.get(`/admin/api/keys/${id}/stats`); }
export function fetchKeyRules(keyId) { return api.get(`/admin/api/keys/${keyId}/rules`); }
export function createKeyRule(keyId, data) { return api.post(`/admin/api/keys/${keyId}/rules`, data); }
export function updateKeyRule(ruleId, data) { return api.put(`/admin/api/rules/${ruleId}`, data); }
export function deleteKeyRule(ruleId) { return api.delete(`/admin/api/rules/${ruleId}`); }
export function reloadRouter() { return api.post("/admin/api/reload"); }
export function checkHealth() { return api.get("/admin/api/health"); }
