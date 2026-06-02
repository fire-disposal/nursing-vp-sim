import { create } from "zustand";
import { login as apiLogin, getMe } from "../api";

const useAuthStore = create((set, get) => ({
  user: (() => {
    const userStr = localStorage.getItem("user");
    if (userStr) {
      try {
        return JSON.parse(userStr);
      } catch {
        return null;
      }
    }
    return null;
  })(),
  token: (() => {
    return localStorage.getItem("token") || null;
  })(),

  login: async (username, password) => {
    const { data } = await apiLogin(username, password);
    localStorage.setItem("token", data.access_token);
    const user = { role: data.role, display_name: data.display_name, user_id: data.user_id };
    localStorage.setItem("user", JSON.stringify(user));
    set({ user, token: data.access_token });
    return user;
  },

  refreshUser: async () => {
    try {
      const { data } = await getMe();
      const user = { role: data.role, display_name: data.display_name, user_id: data.id };
      localStorage.setItem("user", JSON.stringify(user));
      set({ user });
    } catch {
      get().logout();
    }
  },

  logout: () => {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    set({ user: null, token: null });
  },
}));

export default useAuthStore;
