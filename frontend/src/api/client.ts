import axios from "axios";
import useAuthStore, { isRefreshing, setRefreshing } from "@/stores/authStore";
import { accessHeaders } from "@/utils/accessContext";

export const api = axios.create({
	baseURL: "/api",
	timeout: 30_000,  // 30s — LLM streaming uses SSE, not axios
});

let failedQueue: Array<{
	resolve: (value?: unknown) => void;
	reject: (reason?: unknown) => void;
}> = [];

const processQueue = (error: unknown) => {
	failedQueue.forEach((p) => {
		if (error) p.reject(error);
		else p.resolve();
	});
	failedQueue = [];
};

api.interceptors.request.use((config) => {
	for (const [key, value] of Object.entries(accessHeaders())) {
		config.headers.set(key, value);
	}
	return config;
});

api.interceptors.response.use(
	(res) => res,
	async (err) => {
		const originalRequest = err.config;

		// 权限口径失效（视角/院校被撤销）：服务端对 `X-View-Persona` / `X-School-Scope`
		// 的越界一律 403「视角不可用 / 院校不可用」。此时本地状态已过时，重新拉一次
		// `/auth/me`（refreshUser 会清掉失效选择并回落默认）再重放本次请求。只重试一次。
		const accessDetail = err.response?.data?.detail;
		const isMeRequest = !!originalRequest?.url?.includes("/auth/me");
		if (
			err.response?.status === 403 &&
			(accessDetail === "视角不可用" || accessDetail === "院校不可用") &&
			originalRequest &&
			!isMeRequest &&
			!originalRequest._accessRetry
		) {
			originalRequest._accessRetry = true;
			await useAuthStore.getState().refreshUser();
			return api(originalRequest);
		}

		if (
			err.response?.status === 401 &&
			!originalRequest?._retry &&
			!originalRequest?.url?.includes("/auth/refresh") &&
			!originalRequest?.url?.includes("/auth/logout")
		) {
			if (isRefreshing) {
				return new Promise((resolve, reject) => {
					failedQueue.push({ resolve, reject });
				}).then(() => api(originalRequest));
			}

			originalRequest._retry = true;
			setRefreshing(true);

			try {
				const refreshResult = await useAuthStore.getState().refreshAuth();
				if (refreshResult) {
					processQueue(null);
					const newToken = useAuthStore.getState().token;
					originalRequest.headers.Authorization = `Bearer ${newToken}`;
					return api(originalRequest);
				}
				// refreshAuth 返回 false 有两种情况：
				//  - 真 401（refresh token 失效）：refreshAuth 已清空会话 → token 变为 null，需登出跳转登录。
				//  - 网络/服务端抖动：refreshAuth 刻意保留会话 → token 仍在，此时不能误登出，仅拒绝本次请求。
				processQueue(err);
				if (useAuthStore.getState().token == null) {
					console.warn("[axios] refresh token 失效，登出");
					useAuthStore.getState().logout();
				} else {
					console.warn("[axios] Token 刷新遇网络/服务端错误 — 保持会话");
				}
				return Promise.reject(err);
			} catch {
				processQueue(err);
				if (useAuthStore.getState().token == null) {
					useAuthStore.getState().logout();
				}
				return Promise.reject(err);
			} finally {
				setRefreshing(false);
			}
		}

		const retryCount = originalRequest?._retryCount ?? 0;
		const MAX_RETRIES = 3;
		if (!originalRequest || retryCount >= MAX_RETRIES) {
			return Promise.reject(err);
		}
		if (!navigator.onLine) {
			return Promise.reject(err);
		}
		const isIdempotent =
			!originalRequest.method ||
			["get", "head", "options"].includes(originalRequest.method.toLowerCase());
		const isConnectionError =
			err.code === "ECONNREFUSED" ||
			err.code === "ERR_NETWORK" ||
			err.code === "ECONNABORTED" ||
			err.code === "ETIMEDOUT";
		const isProxyError =
			err.response?.status === 502 ||
			err.response?.status === 503 ||
			err.response?.status === 504;
		const shouldRetry =
			isIdempotent &&
			(isConnectionError ||
				isProxyError ||
				(err.response && err.response.status >= 500));
		if (!shouldRetry) {
			return Promise.reject(err);
		}
		// 离线时不盲目等待退避：直接失败，交由上层（网络横幅/重试按钮）处理
		if (typeof navigator !== "undefined" && !navigator.onLine) {
			return Promise.reject(
				new Error("网络已断开，请检查网络连接后重试"),
			);
		}
		const delay = Math.min(1000 * 2 ** retryCount, 8000);
		console.warn(
			"[axios] 后端未就绪，%ds 后重试 (%d/%d): %s %s",
			delay / 1000,
			retryCount + 1,
			MAX_RETRIES,
			originalRequest.method,
			originalRequest.url,
		);
		originalRequest._retryCount = retryCount + 1;
		await new Promise((resolve) => setTimeout(resolve, delay));
		return api(originalRequest);
	},
);
