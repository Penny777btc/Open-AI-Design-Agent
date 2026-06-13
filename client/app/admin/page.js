"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { PicsmithMark } from "@/components/Logo";
import { API, adminGet, Metric, MiniBars, SudoProvider, fmtMoney, fmtBytes } from "./ui";
import axios from "axios";
import UsersTab from "./UsersTab";
import OrdersTab from "./OrdersTab";
import AssetsTab from "./AssetsTab";
import AuditTab from "./AuditTab";

const TABS = [
  { key: "users", label: "用户" },
  { key: "orders", label: "订单" },
  { key: "assets", label: "内容巡查" },
  { key: "audit", label: "审计日志" },
];

// 与 not-found.js 一致的「页面不存在」（不暴露这是管理入口）
function NotFoundDisguise() {
  return (
    <div className="min-h-dvh grid-bg flex flex-col items-center justify-center gap-6 px-6 text-center">
      <PicsmithMark size={40} className="text-white" />
      <div className="micro-label">// 404 · NOT_FOUND</div>
      <h1 className="font-display text-4xl sm:text-6xl font-extrabold tracking-tight">页面不存在</h1>
      <p className="text-secondary-text text-sm max-w-sm">你访问的页面已被移动或从未存在。</p>
      <div className="flex gap-3 mt-2">
        <Link href="/" className="px-6 py-2.5 bg-white text-black rounded-sm text-[11px] font-bold uppercase tracking-[0.15em] hover:bg-gray-200 transition-all">
          返回首页
        </Link>
        <Link href="/dashboard" className="px-6 py-2.5 border border-white/15 bg-white/5 text-gray-400 rounded-sm text-[11px] font-bold uppercase tracking-[0.15em] hover:text-white hover:border-white/30 transition-all">
          进入工作台
        </Link>
      </div>
    </div>
  );
}

export default function AdminPage() {
  const [state, setState] = useState("loading"); // loading | denied | ready
  const [metrics, setMetrics] = useState(null);
  const [series, setSeries] = useState(null);
  const [role, setRole] = useState(null); // admin | support
  const [tab, setTab] = useState("users");

  useEffect(() => {
    adminGet("/metrics")
      .then(({ data }) => {
        setMetrics(data);
        setState("ready");
      })
      .catch((err) => {
        // 非管理员后端一律返回 404 → 渲染伪装页。其余错误同样不暴露入口。
        setState("denied");
      });
    // 角色：support 仅可读 → 隐藏一切变更钮。
    axios
      .get(`${API}/api/v1/auth/me`)
      .then(({ data }) => setRole(data.role || "user"))
      .catch(() => {});
    // 30 天趋势：失败静默（不阻塞主指标）。
    adminGet("/metrics/timeseries?days=30")
      .then(({ data }) => setSeries(data))
      .catch(() => {});
  }, []);

  if (state === "loading") {
    return (
      <div className="min-h-dvh bg-bg-page flex items-center justify-center">
        <div className="micro-label animate-pulse">// LOADING</div>
      </div>
    );
  }
  if (state === "denied") return <NotFoundDisguise />;

  const jobs = metrics?.jobs_24h || {};
  const jobsTotal = Object.values(jobs).reduce((a, b) => a + (b || 0), 0);
  const successRate = jobsTotal > 0 ? Math.round(((jobs.done || 0) / jobsTotal) * 100) : 0;
  const readOnly = role === "support";

  return (
    <SudoProvider>
    <div className="min-h-dvh bg-bg-page text-primary-text">
      <main className="max-w-6xl mx-auto px-6 py-10 flex flex-col gap-8">
        {/* 头部 */}
        <div className="flex items-end justify-between">
          <div className="flex flex-col gap-2">
            <div className="micro-label">// ADMIN · 运营控制台</div>
            <div className="flex items-center gap-3">
              <h1 className="font-display text-3xl font-extrabold tracking-tight">管理后台</h1>
              {readOnly ? (
                <span className="inline-block px-2.5 py-1 rounded-sm border border-amber-500/40 text-amber-400 bg-amber-500/10 text-[9px] font-bold uppercase tracking-[0.15em] font-mono">
                  只读 · SUPPORT
                </span>
              ) : null}
            </div>
          </div>
          <Link href="/dashboard" className="micro-label hover:text-white transition-colors">// ← STUDIO</Link>
        </div>

        {/* 指标卡 */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <Metric label="总用户" value={metrics.users_total ?? "—"} />
          <Metric label="7日新增" value={metrics.users_new_7d ?? "—"} />
          <Metric
            label="24H 任务成功率"
            value={`${successRate}%`}
            hint={`${jobs.done || 0}/${jobsTotal}`}
          />
          <Metric label="24H 积分消耗" value={metrics.credits_consumed_24h ?? "—"} />
          <Metric
            label="累计收入"
            value={fmtMoney(metrics.revenue_cents_total)}
            hint={`${metrics.orders_paid_total ?? 0} 笔已付`}
          />
          <Metric label="存储用量" value={fmtBytes(metrics.storage_bytes_total)} />
        </div>

        {/* 30 天趋势迷你图 */}
        {series?.length ? (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <MiniBars label="近 30 天 · 注册" data={series.map((d) => d.signups)} color="white" />
            <MiniBars label="近 30 天 · 积分消耗" data={series.map((d) => d.credits_consumed)} color="gray" />
            <MiniBars
              label="近 30 天 · 收入"
              data={series.map((d) => d.revenue_cents)}
              color="emerald"
              format={(c) => fmtMoney(c)}
            />
          </div>
        ) : null}

        {/* Tab 导航 */}
        <div className="flex gap-1 border-b border-white/[0.08]">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-4 py-2.5 text-[11px] font-bold uppercase tracking-[0.15em] border-b-2 -mb-px transition-all ${
                tab === t.key
                  ? "border-white text-white"
                  : "border-transparent text-gray-500 hover:text-gray-300"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Tab 内容 */}
        <div>
          {tab === "users" && <UsersTab readOnly={readOnly} />}
          {tab === "orders" && <OrdersTab readOnly={readOnly} />}
          {tab === "assets" && <AssetsTab readOnly={readOnly} />}
          {tab === "audit" && <AuditTab />}
        </div>
      </main>
    </div>
    </SudoProvider>
  );
}
