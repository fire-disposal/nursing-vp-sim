import { api } from "../client";

export interface SchoolBudget {
	school_id: number;
	school_name: string;
	llm_monthly_limit: number;
	tts_monthly_limit: number;
	default_daily_llm_limit: number | null;
	default_daily_tts_limit: number | null;
	llm_used: number;
	tts_used: number;
}

export interface UserBudget {
	user_id: number;
	username: string;
	display_name: string;
	school_id: number | null;
	daily_llm_limit: number;
	daily_tts_limit: number;
	is_default: boolean;
	source: string;
	llm_used_today: number;
	tts_used_today: number;
	school_name: string | null;
	school_llm_limit: number;
	school_tts_limit: number;
	school_llm_used: number;
	school_tts_used: number;
}

export interface SchoolBudgetUpdate {
	llm_monthly_limit: number;
	tts_monthly_limit: number;
	default_daily_llm_limit: number | null;
	default_daily_tts_limit: number | null;
}

export const getSchoolBudgets = () =>
	api.get<SchoolBudget[]>("/admin/costs/budgets/schools");

export const setSchoolBudget = (id: number, data: SchoolBudgetUpdate) =>
	api.put<SchoolBudget>(`/admin/costs/budgets/schools/${id}`, data);

export const getUserBudgets = (params: { search?: string; school_id?: number; limit?: number }) =>
	api.get<UserBudget[]>("/admin/costs/budgets/users", { params });

export const setUserBudget = (id: number, data: { llm_limit: number; tts_limit: number }) =>
	api.put<UserBudget>(`/admin/costs/budgets/users/${id}`, data);


export interface MyQuota {
	llm: { limit: number; used: number; source: string };
	tts: { limit: number; used: number; source: string };
	school_name: string | null;
	school_llm_limit: number;
	school_tts_limit: number;
	school_llm_used: number;
	school_tts_used: number;
	day_reset_at: string;
	month_reset_at: string;
}

export const getMyQuota = () => api.get<MyQuota>("/admin/costs/budgets/me");

export const clearSchoolBudget = (id: number) =>
	api.delete<{ ok: boolean }>(`/admin/costs/budgets/schools/${id}`);

export const clearUserBudget = (id: number) =>
	api.delete<{ ok: boolean }>(`/admin/costs/budgets/users/${id}`);
