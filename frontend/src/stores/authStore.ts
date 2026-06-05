import { create } from "zustand";
import { login as apiLogin, getMe } from "@/api/api-client";
import type { AuthState, User } from "../types/store";

const useAuthStore = create<AuthState>((set, get) => ({
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

  login: async (username: string, password: string): Promise<User> => {
    const { data } = await apiLogin(username, password);
    localStorage.setItem("token", data.access_token);
    const user: User = {
      user_id: data.user_id,
      role: data.role,
      role_display_name: (data as any).role_display_name || data.role,
      display_name: data.display_name,
      school_id: (data as any).school_id ?? undefined,
      school_name: (data as any).school_name ?? undefined,
    };
    localStorage.setItem("user", JSON.stringify(user));
    const perms = (data as any).permissions || [];
    localStorage.setItem("user_permissions", JSON.stringify(perms));
    set({ user, token: data.access_token });
    return user;
  },

  refreshUser: async (): Promise<void> => {
    try {
      const { data } = await getMe();
      const user: User = {
        user_id: data.id,
        role: data.role,
        role_display_name: (data as any).role_display_name || data.role,
        display_name: data.display_name,
      };
      localStorage.setItem("user", JSON.stringify(user));
      set({ user });
    } catch {
      console.warn("[authStore] refreshUser 失败，强制登出");
      get().logout();
    }
  },

  logout: (): void => {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    localStorage.removeItem("user_permissions");
    set({ user: null, token: null });
  },
}));

export default useAuthStore;
