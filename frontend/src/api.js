import axios from "axios";

import { clearAuth } from "./utils/auth";
import { getActiveApiBaseUrl } from "./utils/apiBase";

const API = axios.create({
  baseURL: getActiveApiBaseUrl(),
});

export function refreshApiBaseUrl() {
  API.defaults.baseURL = getActiveApiBaseUrl();
  return API.defaults.baseURL;
}

API.interceptors.request.use((config) => {
  config.baseURL = getActiveApiBaseUrl();
  const token = localStorage.getItem("token");
  if (token) {
    config.headers = config.headers || {};
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

API.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error?.response?.status;
    const requestUrl = String(error?.config?.url || "");
    const isLoginRequest = requestUrl.includes("/login");

    if (status === 401 && !isLoginRequest) {
      clearAuth();
      delete API.defaults.headers.common.Authorization;
      if (window.location.pathname !== "/login") {
        window.location.replace("/login");
      }
    }

    return Promise.reject(error);
  }
);

export default API;
