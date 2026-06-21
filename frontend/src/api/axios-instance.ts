import axios from "axios";
import useAuthStore, { isRefreshing, setRefreshing } from "@/stores/authStore";

export const api = axios.create({
	baseURL: "/api",
	timeout: 120000,
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
	const token = useAuthStore.getState().token;
	if (token) {
		config.headers.Authorization = `Bearer ${token}`;
	}
	return config;
});

api.interceptors.response.use(
	(res) => {
		const body = res.data;
		if (body && typeof body === "object" && "code" in body) {
			if (body.code !== 0) {
				const message = body.message || "未知错误";
				const error = new Error(message) as Error & { code: number };
				error.code = body.code;
				return Promise.reject(error);
			}
			res.data = body.data;
		}
		return res;
	},
	async (err) => {
		const originalRequest = err.config;

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
				throw new Error("refresh failed");
			} catch {
				processQueue(err);
				console.warn("[axios] Token 刷新失败");
				useAuthStore.getState().logout();
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
