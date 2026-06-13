"use client";

// 管理台共享：API 基址、axios 封装、样式 token、格式化与小组件。
import { createContext, useCallback, useContext, useRef, useState } from "react";
import axios from "axios";
import toast from "react-hot-toast";

export const API = process.env.NEXT_PUBLIC_API_BASE || "http://127.0.0.1:8000";
export const ADMIN = `${API}/api/v1/admin`;

// 共享 axios 实例（ApiContext 已全局安装拦截器：自动注入 token + 401 跳登录）。
export const adminGet = (path, config) => axios.get(`${ADMIN}${path}`, config);
export const adminPost = (path, body) => axios.post(`${ADMIN}${path}`, body);

// 统一错误文案：优先后端 detail。
export const errMsg = (err, fallback = "操作失败") =>
  err?.response?.data?.detail || fallback;

// ── Sudo（敏感操作重验密码）──────────────────────────────────────────
// 密码只存 React state（内存级）。持久化等于把密码防线打回 token 防线，绝不入 storage。
// useSudo().run(fn) 会确保拿到密码后以 sudoConfig(pw) 调用 fn；收到 403 自动清状态并重弹框。
const SudoContext = createContext(null);

// 把 sudo 密码拼成请求头 config（用于 adminPost / axios.patch / axios.delete）。
export const sudoConfig = (pw, extra) => ({
  ...extra,
  headers: { ...(extra?.headers || {}), "X-Sudo-Password": pw },
});

export function SudoProvider({ children }) {
  const [pw, setPw] = useState(null); // 内存级：刷新即失效
  const pending = useRef(null); // { resolve, reject }
  const [asking, setAsking] = useState(false);

  // 确保有密码：有则直接返回；无则弹框等待用户输入。
  const ensure = useCallback(() => {
    if (pw) return Promise.resolve(pw);
    return new Promise((resolve, reject) => {
      pending.current = { resolve, reject };
      setAsking(true);
    });
  }, [pw]);

  const submitAsk = useCallback((value) => {
    setPw(value);
    setAsking(false);
    pending.current?.resolve(value);
    pending.current = null;
  }, []);

  const cancelAsk = useCallback(() => {
    setAsking(false);
    pending.current?.reject(new Error("sudo-cancelled"));
    pending.current = null;
  }, []);

  // 执行一个敏感请求：fn(pw) 必须返回 Promise（内部用 sudoConfig 带头）。
  // 403 → 清空内存密码、提示、重弹框，再重试一次；二次仍失败则抛出。
  const run = useCallback(
    async (fn) => {
      let password;
      try {
        password = await ensure();
      } catch {
        return undefined; // 用户取消，静默
      }
      try {
        return await fn(password);
      } catch (err) {
        if (err?.response?.status === 403) {
          setPw(null);
          toast.error("密码验证失败，请重新输入");
          let retryPw;
          try {
            retryPw = await new Promise((resolve, reject) => {
              pending.current = { resolve, reject };
              setAsking(true);
            });
          } catch {
            return undefined;
          }
          return await fn(retryPw);
        }
        throw err;
      }
    },
    [ensure]
  );

  return (
    <SudoContext.Provider value={{ run }}>
      {children}
      {asking ? <SudoModal onSubmit={submitAsk} onCancel={cancelAsk} /> : null}
    </SudoContext.Provider>
  );
}

export const useSudo = () => useContext(SudoContext);

function SudoModal({ onSubmit, onCancel }) {
  const [value, setValue] = useState("");
  const ok = value.length >= 1;
  return (
    <Overlay onClose={onCancel}>
      <div className="flex flex-col gap-2">
        <div className="micro-label">// 验证身份</div>
        <p className="text-[12px] text-gray-400 leading-relaxed">
          这是敏感操作。请输入你的<span className="text-white">管理员登录密码</span>以继续。
          密码仅在本次页面会话内存于内存，不会被保存。
        </p>
      </div>
      <input
        type="password"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && ok) onSubmit(value);
        }}
        placeholder="管理员密码"
        className={inputCls}
        autoFocus
      />
      <div className="flex justify-end gap-3 mt-1">
        <button onClick={onCancel} className={btnGhost}>取消</button>
        <button onClick={() => ok && onSubmit(value)} disabled={!ok} className={btnPrimary}>
          确认
        </button>
      </div>
    </Overlay>
  );
}

// 共享遮罩弹层（与调积分 / 封禁弹层一致）。
export function Overlay({ children, onClose }) {
  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className={`${cardCls} w-full max-w-md p-6 flex flex-col gap-4`}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}

// ── CSV 导出 ─────────────────────────────────────────────────────────
// 单元格转义：含逗号 / 引号 / 换行时整体包引号，并把内部引号翻倍。
const csvCell = (v) => {
  const s = v == null ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

// rows: 对象数组；columns: [{ key, label, get?(row) }]。导出当前已加载行。
export function exportCsv(filename, columns, rows) {
  if (!rows || rows.length === 0) {
    toast.error("当前没有可导出的数据");
    return;
  }
  const header = columns.map((c) => csvCell(c.label)).join(",");
  const body = rows
    .map((r) => columns.map((c) => csvCell(c.get ? c.get(r) : r[c.key])).join(","))
    .join("\r\n");
  // ﻿ BOM 让 Excel 正确识别 UTF-8。
  const blob = new Blob(["﻿" + header + "\r\n" + body], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const stamp = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `${filename}-${stamp}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

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

// 筛选 chip（用户 Tab 状态过滤）
export function Chip({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 rounded-sm border text-[10px] font-bold uppercase tracking-[0.15em] transition-all ${
        active
          ? "border-white/30 text-white bg-white/10"
          : "border-white/10 text-gray-500 bg-white/[0.02] hover:text-gray-300 hover:border-white/20"
      }`}
    >
      {children}
    </button>
  );
}

// 「导出 CSV」按钮：导出当前已加载的 rows。
export function CsvButton({ filename, columns, rows, disabled }) {
  return (
    <button
      onClick={() => exportCsv(filename, columns, rows)}
      disabled={disabled || !rows?.length}
      className={btnGhost}
      title="导出当前已加载的行"
    >
      导出 CSV
    </button>
  );
}

// 迷你 SVG 柱状趋势图（无图表库）。data: number[]；约 60px 高，hover 显示数值。
export function MiniBars({ label, data, color = "white", format = (v) => v }) {
  const vals = (data || []).map((v) => Number(v) || 0);
  const max = Math.max(1, ...vals);
  const n = vals.length || 1;
  const W = 100;
  const H = 60;
  const gap = 1.2;
  const bw = (W - gap * (n - 1)) / n;
  const last = vals.length ? vals[vals.length - 1] : 0;
  const toneCls =
    color === "emerald"
      ? "fill-emerald-400/70 hover:fill-emerald-400"
      : color === "gray"
      ? "fill-gray-400/60 hover:fill-gray-300"
      : "fill-white/70 hover:fill-white";
  return (
    <div className={`${cardCls} px-4 py-3 flex flex-col gap-2`}>
      <div className="flex items-baseline justify-between">
        <div className="micro-label">{label}</div>
        <div className="font-data text-sm text-gray-300">{format(last)}</div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full h-[60px]" aria-hidden="false">
        {vals.map((v, i) => {
          const h = max > 0 ? (v / max) * (H - 2) : 0;
          return (
            <rect
              key={i}
              x={i * (bw + gap)}
              y={H - h}
              width={bw}
              height={h || 0.5}
              className={`${toneCls} transition-colors`}
            >
              <title>{`${format(v)}`}</title>
            </rect>
          );
        })}
      </svg>
    </div>
  );
}
