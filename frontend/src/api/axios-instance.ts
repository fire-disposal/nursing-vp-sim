import axios from "axios";

export const api = axios.create({
  baseURL: "/api",
  timeout: 120000,
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("token");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
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
    if (!config || config._retryCount >= 1) {
      return Promise.reject(err);
    }
    const isIdempotent = !config.method || ["get", "head", "options"].includes(config.method.toLowerCase());
    const shouldRetry = isIdempotent && (!err.response || err.response.status >= 500 || err.code === "ECONNABORTED" || err.code === "ERR_NETWORK");
    if (!shouldRetry) {
      return Promise.reject(err);
    }
    console.warn("[axios] 重试请求:", config.method, config.url, "(第", config._retryCount + 1, "次)");
    config._retryCount = (config._retryCount || 0) + 1;
    await new Promise((resolve) => setTimeout(resolve, 1000));
    return api(config);
  },
);
