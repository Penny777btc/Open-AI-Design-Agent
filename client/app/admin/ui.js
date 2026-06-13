"use client";

// 管理台共享：API 基址、axios 封装、样式 token、格式化与小组件。
import axios from "axios";

export const API = process.env.NEXT_PUBLIC_API_BASE || "http://127.0.0.1:8000";
export const ADMIN = `${API}/api/v1/admin`;

// 共享 axios 实例（ApiContext 已全局安装拦截器：自动注入 token + 401 跳登录）。
export const adminGet = (path, config) => axios.get(`${ADMIN}${path}`, config);
export const adminPost = (path, body) => axios.post(`${ADMIN}${path}`, body);

// 统一错误文案：优先后端 detail。
export const errMsg = (err, fallback = "操作失败") =>
  err?.response?.data?.detail || fallback;

// ── 样式 token（与 billing / account 页保持一致的工业质感）─────────────
export const cardCls =
  "bg-bg-card border border-white/[0.08] rounded-sm";
export const inputCls =
  "w-full px-4 py-2.5 bg-white/[0.02] border border-white/10 rounded-sm text-white placeholder-gray-600 focus:outline-none focus:border-white/30 transition-all font-mono text-sm";
export const btnPrimary =
  "px-5 py-2.5 bg-white text-black rounded-sm text-[11px] font-bold uppercase tracking-[0.15em] hover:bg-gray-200 transition-all disabled:opacity-50 disabled:cursor-not-allowed";
export const btnGhost =
  "px-4 py-2 border border-white/15 bg-white/5 text-gray-400 rounded-sm text-[10px] font-bold uppercase tracking-[0.15em] hover:text-white hover:border-white/30 transition-all disabled:opacity-50";
export const btnDanger =
  "px-4 py-2 bg-red-500/15 border border-red-500/40 text-red-400 rounded-sm text-[10px] font-bold uppercase tracking-[0.15em] hover:bg-red-500/25 transition-all disabled:opacity-40 disabled:cursor-not-allowed";

// ── 格式化辅助 ───────────────────────────────────────────────────────
export const fmtDate = (s) => (s ? new Date(s).toLocaleString() : "—");

export const fmtMoney = (cents, currency) => {
  const v = ((cents || 0) / 100).toFixed(2);
  const sym = (currency || "usd").toLowerCase() === "usd" ? "$" : "";
  return `${sym}${v}`;
};

export const fmtBytes = (bytes) => {
  const b = bytes || 0;
  if (b < 1024) return `${b} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = b / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(2)} ${units[i]}`;
};

// ── 通用小组件 ───────────────────────────────────────────────────────
export function Metric({ label, value, hint }) {
  return (
    <div className={`${cardCls} px-5 py-4 flex flex-col gap-1.5`}>
      <div className="micro-label">{label}</div>
      <div className="font-data text-3xl leading-none">{value}</div>
      {hint ? <div className="text-[11px] text-gray-600 font-mono">{hint}</div> : null}
    </div>
  );
}

export function Badge({ tone = "ok", children }) {
  const map = {
    ok: "border-white/15 text-gray-300 bg-white/5",
    admin: "border-white/30 text-white bg-white/10",
    banned: "border-red-500/40 text-red-400 bg-red-500/10",
    muted: "border-white/10 text-gray-500 bg-white/[0.02]",
    paid: "border-emerald-500/40 text-emerald-400 bg-emerald-500/10",
    fail: "border-red-500/40 text-red-400 bg-red-500/10",
  };
  return (
    <span
      className={`inline-block px-2 py-0.5 rounded-sm border text-[9px] font-bold uppercase tracking-[0.15em] font-mono ${map[tone] || map.muted}`}
    >
      {children}
    </span>
  );
}

export function LoadMore({ onClick, loading, done, empty, emptyText = "暂无数据" }) {
  if (empty) {
    return <div className="px-5 py-8 text-center text-[13px] text-gray-600">{emptyText}</div>;
  }
  if (done) {
    return <div className="px-5 py-4 text-center text-[10px] text-gray-700 font-mono uppercase tracking-[0.2em]">// 已全部加载</div>;
  }
  return (
    <div className="px-5 py-4 flex justify-center">
      <button onClick={onClick} disabled={loading} className={btnGhost}>
        {loading ? "加载中…" : "加载更多"}
      </button>
    </div>
  );
}

// 表格表头单元格
export function Th({ children, className = "" }) {
  return (
    <th className={`text-left font-normal px-4 py-2.5 micro-label ${className}`}>{children}</th>
  );
}
