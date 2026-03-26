import axios from "axios";

const rawBackendUrl =
  import.meta.env.VITE_BACKEND_URL || import.meta.env.VITE_API_URL || "";

const normalizedBackendUrl = rawBackendUrl.replace(/\/+$/, "");

const apiBaseUrl = normalizedBackendUrl
  ? normalizedBackendUrl.endsWith("/api")
    ? normalizedBackendUrl
    : `${normalizedBackendUrl}/api`
  : "/api";

const api = axios.create({
  baseURL: apiBaseUrl,
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("tt_token");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export default api;
