import type { ApiPath } from "./api-path";
import type { components } from "./api-types.gen";
import { api } from "./axios-instance";

type Schemas = components["schemas"];

export const login = (username: string, password: string) =>
	api.post<Schemas["TokenResponse"]>(
		"/auth/login" satisfies ApiPath as string,
		{ username, password },
	);

export const register = (data: Schemas["RegisterRequest"]) =>
	api.post<Schemas["TokenResponse"]>(
		"/auth/register" satisfies ApiPath as string,
		data,
	);

export const getMe = () =>
	api.get<Schemas["UserBrief"]>(
		"/auth/me" satisfies ApiPath as string,
	);

export const refreshToken = () =>
	api.post<Schemas["TokenResponse"]>(
		"/auth/refresh" satisfies ApiPath as string,
	);

export const changePassword = (oldPassword: string, newPassword: string) =>
	api.put<Schemas["OkResponse"]>(
		"/auth/change-password" satisfies ApiPath as string,
		{ old_password: oldPassword, new_password: newPassword },
	);

export const updateMyProfile = (data: Schemas["UserProfileUpdateRequest"]) =>
	api.put<Schemas["UserBrief"]>(
		"/auth/me" satisfies ApiPath as string,
		data,
	);
