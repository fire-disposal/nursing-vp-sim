import { create } from "zustand";
import { login as apiLogin, getMe } from "../api";
import type { AuthState, User } from "../types/store";

const useAuthStore = create<AuthState>((set, get) => ({
  user: ((): User | null => {
    const userStr = localStorage.getItem("user");
    if (userStr) {
      try {
        return JSON.parse(userStr) as User;
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
    const user: User = { user_id: data.user_id, role: data.role as User["role"], display_name: data.display_name };
    localStorage.setItem("user", JSON.stringify(user));
    set({ user, token: data.access_token });
    return user;
  },

  refreshUser: async (): Promise<void> => {
    try {
      const { data } = await getMe();
      const user: User = { user_id: data.id, role: data.role as User["role"], display_name: data.display_name };
      localStorage.setItem("user", JSON.stringify(user));
      set({ user });
    } catch {
      get().logout();
    }
  },

  logout: (): void => {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    set({ user: null, token: null });
  },
}));

export default useAuthStore;
