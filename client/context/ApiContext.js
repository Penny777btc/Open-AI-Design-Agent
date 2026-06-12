"use client";
import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import axios from "axios";

const ApiContext = createContext();

const BASE_URL = process.env.NEXT_PUBLIC_API_BASE || "http://127.0.0.1:8000";

// 全局鉴权：所有 axios 请求自动带 token；401 统一踢回登录页
let interceptorsInstalled = false;
function installInterceptors() {
  if (interceptorsInstalled) return;
  interceptorsInstalled = true;
  axios.interceptors.request.use((config) => {
    const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
    if (token && !config.headers.Authorization) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  });
  axios.interceptors.response.use(
    (resp) => resp,
    (error) => {
      if (error.response?.status === 401 && typeof window !== "undefined") {
        const path = window.location.pathname;
        const isPublic = path === "/" || path.startsWith("/login") || path.startsWith("/register");
        if (!isPublic) {
          localStorage.removeItem("token");
          window.location.href = `/login?next=${encodeURIComponent(path + window.location.search)}`;
        }
      }
      return Promise.reject(error);
    }
  );
}

export function ApiProvider({ children }) {
  const [userData, setUserData] = useState(null);
  const [loading, setLoading] = useState(true);
  const apiKey = "client";

  installInterceptors();

  const fetchUserData = useCallback(async () => {
    if (typeof window !== "undefined" && !localStorage.getItem("token")) {
      setUserData(null);
      setLoading(false);
      return;
    }
    try {
      const { data } = await axios.get(`${BASE_URL}/api/v1/auth/me`);
      setUserData({
        username: data.name || data.email?.split("@")[0] || "User",
        balance: data.balance ?? 0,
        email: data.email,
      });
    } catch (err) {
      setUserData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUserData();
  }, [fetchUserData]);

  const logout = useCallback(() => {
    localStorage.removeItem("token");
    setUserData(null);
    window.location.href = "/";
  }, []);

  return (
    <ApiContext.Provider value={{ apiKey, userData, loading, fetchUserData, logout }}>
      {children}
    </ApiContext.Provider>
  );
}

export const useApi = () => useContext(ApiContext);
