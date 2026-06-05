import axios from "axios";
import useSchoolStore from "@/stores/schoolStore";

export const api = axios.create({
  baseURL: "/api",
  timeout: 120000,
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("token");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  const schoolId = useSchoolStore.getState().selectedSchoolId;
  if (schoolId != null) {
    config.params = { ...config.params, school_id: schoolId };
  }
  return config;
});

api.interceptors.response.use(
  (res) => res,
  async (err) => {
    if (err.response?.status === 401) {
      console.warn("[axios] 401 未授权，清除 token 并跳转登录页");
      localStorage.removeItem("token");
      localStorage.removeItem("user");
      if (!window.location.pathname.includes("/login")) {
        window.location.href = "/login";
      }
      return Promise.reject(err);
    }
    const config = err.config;
    const retryCount = config?._retryCount ?? 0;
    const MAX_RETRIES = 3;
    if (!config || retryCount >= MAX_RETRIES) {
      return Promise.reject(err);
    }
    const isIdempotent = !config.method || ["get", "head", "options"].includes(config.method.toLowerCase());
    const isConnectionError = err.code === "ECONNREFUSED" || err.code === "ERR_NETWORK" || err.code === "ECONNABORTED" || err.code === "ETIMEDOUT";
    const isProxyError = err.response?.status === 502 || err.response?.status === 503 || err.response?.status === 504;
    const shouldRetry = isIdempotent && (isConnectionError || isProxyError || (err.response && err.response.status >= 500));
    if (!shouldRetry) {
      return Promise.reject(err);
    }
    const delay = Math.min(1000 * 2 ** retryCount, 8000);
    console.warn("[axios] 后端未就绪，%ds 后重试 (%d/%d): %s %s", delay / 1000, retryCount + 1, MAX_RETRIES, config.method, config.url);
    config._retryCount = retryCount + 1;
    await new Promise((resolve) => setTimeout(resolve, delay));
    return api(config);
  },
);
