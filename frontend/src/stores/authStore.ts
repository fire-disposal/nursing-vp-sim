import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
	login as apiLogin,
	logout as apiLogout,
	refreshToken as apiRefreshToken,
	getMe,
} from "@/api";
import { dispatchForceLogout } from "@/events";
import type { AuthState, User } from "../types/store";

interface ExtendedAuthState extends AuthState {
	permissions: string[];
	refreshAuth: () => Promise<boolean>;
}

let refreshTimer: ReturnType<typeof setInterval> | null = null;
export let isRefreshing = false;
export function setRefreshing(v: boolean) { isRefreshing = v; }
let isLoggingOut = false;

export function startRefreshTimer(): void {
	const token = useAuthStore.getState().token;
	if (!token) return;
	if (refreshTimer) clearInterval(refreshTimer);
	refreshTimer = setInterval(() => {
		if (isRefreshing) return;
		setRefreshing(true);
		useAuthStore.getState().refreshAuth().finally(() => {
			setRefreshing(false);
		});
	}, 24 * 60 * 60 * 1000);
}

export function stopRefreshTimer(): void {
	if (refreshTimer) {
		clearInterval(refreshTimer);
		refreshTimer = null;
	}
}

type PersistedState = Pick<ExtendedAuthState, "user" | "token" | "permissions">;

const useAuthStore = create<ExtendedAuthState>()(
	persist(
		(set, get) => ({
			user: null,
			token: null,
			permissions: [],

			login: async (username: string, password: string): Promise<User> => {
				const { data } = await apiLogin(username, password);
				const user: User = {
					id: data.user_id,
					username: data.display_name || username,
					role: data.role,
					role_display_name: data.role,
					display_name: data.display_name,
					student_id: null,
					gender: data.gender ?? null,
					// 登录成功即账号为启用态（后端在鉴权层拒绝停用账号，见 auth.service）
					is_active: true,
					avatar: data.avatar ?? null,
					memberships: [],
				};
				set({ user, token: data.access_token, permissions: data.permissions });

				startRefreshTimer();

				try {
					const { data: me } = await getMe();
					const current = get().user;
					if (current) {
						set({
							user: {
								...current,
								role_display_name: me.role_display_name || data.role,
								memberships: me.memberships ?? [],
							},
							// /auth/me 现取权限：改权限后刷新页面即可生效（此前最长 24h 陈旧）
							permissions: me.permissions?.length ? me.permissions : get().permissions,
						});
					}
				} catch {
					// ignore — role_display_name stays as fallback
				}

				return get().user!;
			},

			refreshAuth: async (): Promise<boolean> => {
				try {
					const { data } = await apiRefreshToken();
					set({ token: data.access_token, permissions: data.permissions });
					return true;
			} catch (err: unknown) {
				const is401 = (
					err != null &&
					typeof err === "object" &&
					"response" in err &&
					(err as { response?: { status?: number } }).response?.status === 401
				);
				if (is401) {
					console.warn("[authStore] refreshAuth 401 — 清除会话");
					stopRefreshTimer();
					set({ user: null, token: null, permissions: [] });
				} else {
					console.warn("[authStore] refreshAuth 网络/服务端错误 — 保持现有会话", err);
				}
				return false;
			}
			},

			refreshUser: async (): Promise<void> => {
				try {
					const { data } = await getMe();
					const current = get().user;
					const user: User = {
						id: data.id,
						username: data.username || current?.username || "",
						role: data.role,
						role_display_name: data.role_display_name || data.role,
						display_name: data.display_name,
						student_id: data.student_id ?? null,
						is_active: data.is_active ?? true,
						gender: data.gender ?? null,
						avatar: data.avatar ?? null,
						memberships: data.memberships ?? [],
					};
					// 与登录路径一致：顺带刷新权限集合（/auth/me 现取）
					set({ user, ...(data.permissions?.length ? { permissions: data.permissions } : {}) });
				} catch (err: unknown) {
					// 仅 401 视为会话失效；网络抖动/服务端瞬时错误保留会话（与 refreshAuth 一致）
					const is401 = (
						err != null &&
						typeof err === "object" &&
						"response" in err &&
						(err as { response?: { status?: number } }).response?.status === 401
					);
					if (is401) {
						console.warn("[authStore] refreshUser 401 — 清除会话");
						get().logout();
					} else {
						console.warn("[authStore] refreshUser 网络/服务端错误 — 保持现有会话", err);
					}
				}
			},

			logout: (): void => {
				if (isLoggingOut) return;
				isLoggingOut = true;
				stopRefreshTimer();
				apiLogout().catch(() => {}).finally(() => { isLoggingOut = false; });
				set({ user: null, token: null, permissions: [] });
				dispatchForceLogout();
			},
		}),
		{
			name: "nursing-auth",
			partialize: (state): PersistedState => ({
				user: state.user,
				token: state.token,
				permissions: state.permissions,
			}),
			version: 2,
			migrate: (persisted) => {
				// v1 会话用户把 id 存成 user_id；v2 起统一用 `UserBrief` 的 `id`。
				const p = persisted as PersistedState & { user?: (User & { user_id?: number }) | null };
				if (p.user && p.user.user_id != null) {
					p.user.id = p.user.user_id;
					delete p.user.user_id;
				}
				return p as PersistedState;
			},
			onRehydrateStorage: () => {
				return (state) => {
					if (!state?.token) return;
					startRefreshTimer();
				};
			},
		},
	),
);

export default useAuthStore;
