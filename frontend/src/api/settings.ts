import { api } from "./client";

export interface AppSettings {
	feedback_hint_enabled: boolean;
}

/** 公开子集：只暴露“要不要显示首次反馈引导”，不鉴权。 */
export const getPublicAppSettings = () => api.get<AppSettings>("/settings/public");

export const getAppSettings = () => api.get<AppSettings>("/admin/settings");

export const updateAppSettings = (data: AppSettings) =>
	api.put<AppSettings>("/admin/settings", data);
