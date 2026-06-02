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
      localStorage.removeItem("token");
      localStorage.removeItem("user");
      window.location.href = "/login";
      return Promise.reject(err);
    }
    const config = err.config;
    if (!config || config._retryCount >= 1) {
      return Promise.reject(err);
    }
    const shouldRetry = !err.response || err.response.status >= 500 || err.code === "ECONNABORTED" || err.code === "ERR_NETWORK";
    if (!shouldRetry) {
      return Promise.reject(err);
    }
    config._retryCount = (config._retryCount || 0) + 1;
    await new Promise((resolve) => setTimeout(resolve, 1000));
    return api(config);
  },
);
