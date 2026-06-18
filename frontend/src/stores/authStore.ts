import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
	login as apiLogin,
	logout as apiLogout,
	refreshToken as apiRefreshToken,
	getMe,
} from "@/api/api-client";
import { dispatchForceLogout } from "@/events";
import type { AuthState, User } from "../types/store";

interface ExtendedAuthState extends AuthState {
	permissions: string[];
	refreshAuth: () => Promise<boolean>;
}

let refreshTimer: ReturnType<typeof setInterval> | null = null;
let isRefreshing = false;

export function startRefreshTimer(): void {
	const token = useAuthStore.getState().token;
	if (!token) return;
	if (refreshTimer) clearInterval(refreshTimer);
	refreshTimer = setInterval(() => {
		if (isRefreshing) return;
		isRefreshing = true;
		useAuthStore.getState().refreshAuth().finally(() => {
			isRefreshing = false;
		});
	}, 50 * 60 * 1000);
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
					user_id: data.user_id,
					username: data.display_name || username,
					role: data.role,
					role_display_name: data.role,
					display_name: data.display_name,
					gender: data.gender ?? null,
					avatar: data.avatar ?? null,
					school_id: data.school_id ?? undefined,
					school_name: data.school_name ?? undefined,
				};
				set({ user, token: data.access_token, permissions: data.permissions });

				startRefreshTimer();

				return user;
			},

			refreshAuth: async (): Promise<boolean> => {
				try {
					const { data } = await apiRefreshToken();
					set({ token: data.access_token, permissions: data.permissions });
					return true;
				} catch {
					console.warn("[authStore] refreshAuth 失败");
					get().logout();
					return false;
				}
			},

			refreshUser: async (): Promise<void> => {
				try {
					const { data } = await getMe();
					const current = get().user;
					const user: User = {
						user_id: data.id,
						username: data.username || current?.username || "",
						role: data.role,
						role_display_name: data.role_display_name || data.role,
						display_name: data.display_name,
						gender: data.gender ?? null,
						avatar: data.avatar ?? null,
						grade: data.grade_name ?? current?.grade ?? "",
						className: data.class_name ?? current?.className ?? "",
						school_id: current?.school_id,
						school_name: current?.school_name,
					};
					set({ user });
				} catch {
					console.warn("[authStore] refreshUser 失败");
					get().logout();
				}
			},

			logout: (): void => {
				stopRefreshTimer();
				apiLogout().catch(() => {});
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
			version: 1,
			migrate: (persisted) => {
				const p = persisted as PersistedState & { user?: User & { id?: number } };
				if (p.user?.id && !p.user.user_id) {
					p.user.user_id = p.user.id;
					delete p.user.id;
				}
				return p as PersistedState;
			},
			onRehydrateStorage: () => {
				return (state) => {
					if (state?.token) {
						startRefreshTimer();
					}
				};
			},
		},
	),
);

export default useAuthStore;
