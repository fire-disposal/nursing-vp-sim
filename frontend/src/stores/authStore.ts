import { create } from "zustand";
import {
	login as apiLogin,
	refreshToken as apiRefreshToken,
	getMe,
} from "@/api/api-client";
import type { AuthState, User } from "../types/store";

interface ExtendedAuthState extends AuthState {
	permissions: string[];
	refreshAuth: () => Promise<boolean>;
}

const loadPermissions = (): string[] => {
	try {
		const p = localStorage.getItem("user_permissions");
		return p ? JSON.parse(p) : [];
	} catch {
		return [];
	}
};

let refreshTimer: ReturnType<typeof setInterval> | null = null;
let isRefreshing = false;

export function startRefreshTimer(): void {
	const token = localStorage.getItem("token");
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

const useAuthStore = create<ExtendedAuthState>((set, get) => ({
	user: ((): User | null => {
		const userStr = localStorage.getItem("user");
		if (userStr) {
			try {
				const parsed = JSON.parse(userStr);
				if (parsed.id && !parsed.user_id) {
					parsed.user_id = parsed.id;
					delete parsed.id;
					localStorage.setItem("user", JSON.stringify(parsed));
				}
				return parsed as User;
			} catch {
				return null;
			}
		}
		return null;
	})(),
	token: ((): string | null => {
		return localStorage.getItem("token") || null;
	})(),
	permissions: loadPermissions(),

	login: async (username: string, password: string): Promise<User> => {
		const { data } = await apiLogin(username, password);
		localStorage.setItem("token", data.access_token);
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
		localStorage.setItem("user", JSON.stringify(user));
		localStorage.setItem("user_permissions", JSON.stringify(data.permissions));
		set({ user, token: data.access_token, permissions: data.permissions });

		startRefreshTimer();

		return user;
	},

	refreshAuth: async (): Promise<boolean> => {
		try {
			const { data } = await apiRefreshToken();
			localStorage.setItem("token", data.access_token);
			localStorage.setItem("user_permissions", JSON.stringify(data.permissions));
			set({ token: data.access_token, permissions: data.permissions });
			return true;
		} catch {
			console.warn("[authStore] refreshAuth 失败，强制登出");
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
			localStorage.setItem("user", JSON.stringify(user));
			set({ user });
		} catch {
			console.warn("[authStore] refreshUser 失败，强制登出");
			get().logout();
		}
	},

	logout: (): void => {
		stopRefreshTimer();
		localStorage.removeItem("token");
		localStorage.removeItem("user");
		localStorage.removeItem("user_permissions");
		set({ user: null, token: null, permissions: [] });
	},
}));

export default useAuthStore;
