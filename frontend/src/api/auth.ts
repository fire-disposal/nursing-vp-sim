import type { components } from "./api-types.gen";
import { api } from "./axios-instance";

type Schemas = components["schemas"];

export const login = (username: string, password: string) => api.post<Schemas["TokenResponse"]>("/auth/login", { username, password });

export const register = (data: Schemas["RegisterRequest"]) => api.post<Schemas["TokenResponse"]>("/auth/register", data);

export const getMe = () => api.get<Schemas["UserBrief"]>("/auth/me");

export const refreshToken = () => api.post<Schemas["TokenResponse"]>("/auth/refresh");

export const changePassword = (oldPassword: string, newPassword: string) =>
  api.put<Schemas["OkResponse"]>("/auth/change-password", { old_password: oldPassword, new_password: newPassword });
