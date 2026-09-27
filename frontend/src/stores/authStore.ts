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
	/**
	 * 会话是否已"落定"（权限不早于当前会话）。
	 * 冷启动带持久化 token 时为 `false`，直到 `revalidateSession()` 用 `/auth/me` 现取结果
	 * 覆盖完持久化快照；路由门禁在此前必须先等待，见 `components/ProtectedRoute.tsx`。
	 */
	sessionReady: boolean;
	revalidateSession: () => Promise<void>;
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
			// 默认"已落定"；带持久化 token 冷启动时由 revalidateSession() 同步置 false，
			// 结果落地（或失败）后回到 true。见 components/ProtectedRoute.tsx 的门禁。
			sessionReady: true,

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
							// 权限以 /auth/me 现取为准（返回数组即覆盖，空数组 = 真的没权限）；
							// 字段缺失才留用登录响应里的值。
							permissions: Array.isArray(me.permissions)
								? me.permissions
								: get().permissions,
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
					// 与登录路径一致：顺带刷新权限集合（/auth/me 现取，数组为准，空数组也覆盖）
					set({
						user,
						permissions: Array.isArray(data.permissions)
							? data.permissions
							: get().permissions,
					});
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

			/**
			 * 冷启动会话恢复时的权限 revalidation：拉一次 `/auth/me`，用现取结果覆盖持久化快照。
			 *
			 * 为什么必须有：`localStorage` 里的 `permissions` 是上次会话的快照，可能早于部署后的
			 * 授权变更（生产实例：学生被授予 `scenario_training` 后仍被旧快照挡在 403 页）。
			 * 期间 `sessionReady=false`，`ProtectedRoute` 先显示加载态 —— 门禁不会拿旧快照判定。
			 *
			 * 与 `refreshUser()` 同口径：401 → 清会话；网络/5xx → 保留会话，不把用户踢下线。
			 *
			 * 顺带承担冷启动的"会话已建立"副作用：起 24h token 刷新定时器（见 onRehydrateStorage 的 TDZ 说明）。
			 */
			revalidateSession: async (): Promise<void> => {
				if (get().token == null) {
					set({ sessionReady: true });
					return;
				}
				set({ sessionReady: false });
				try {
					await get().refreshUser();
				} finally {
					set({ sessionReady: true });
					if (get().token) startRefreshTimer();
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
				return (state, error) => {
					if (error || !state?.token) return;
					// 冷启动恢复会话：立刻 revalidate 权限，别让路由门禁沿用持久化快照。
					// `revalidateSession` 同步置 sessionReady=false，因此这里不是 fire-and-forget：
					// 结果（成功或失败）落地前 ProtectedRoute 一直显示加载态。
					//
					// 注意：本回调由 persist 在 store 创建时**同步**触发，此刻模块常量 `useAuthStore`
					// 还在 TDZ —— 以前这里直接调 `startRefreshTimer()`（内部读该常量）会抛 ReferenceError，
					// 被 persist 静默吞掉，于是整个冷启动钩子从未生效。所以刷新定时器改由
					// `revalidateSession()` 在结果落地后启动（那次已是异步上下文）。
					void state.revalidateSession();
				};
			},
		},
	),
);

export default useAuthStore;
