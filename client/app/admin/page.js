"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  FiGrid, FiUsers, FiUserPlus, FiActivity, FiZap, FiDollarSign, FiHardDrive,
  FiShoppingCart, FiBox, FiGift, FiImage, FiFileText, FiMenu, FiX, FiChevronLeft, FiChevronRight, FiLogOut,
} from "react-icons/fi";
import { PicsmithMark } from "@/components/Logo";
import { API, adminGet, MiniBars, SudoProvider, btnGhost, cardCls, fmtMoney, fmtBytes } from "./ui";
import axios from "axios";
import { useLang } from "@/context/LanguageContext";
import { COPY } from "@/lib/copy";
import UsersTab from "./UsersTab";
import OrdersTab from "./OrdersTab";
import PackagesTab from "./PackagesTab";
import RedeemTab from "./RedeemTab";
import AssetsTab from "./AssetsTab";
import AuditTab from "./AuditTab";

// 侧边栏分组导航（取代顶部 Tab）。subtitle 进顶栏，符合常规后台「左导航 + 顶栏 + 卡片区」布局。
const NAV = [
  { group: null, items: [{ key: "overview", label: "概览", icon: FiGrid, sub: "账户与运营概览" }] },
  { group: "用户管理", items: [{ key: "users", label: "用户", icon: FiUsers, sub: "查询 · 积分 · 封禁" }] },
  {
    group: "财务",
    items: [
      { key: "orders", label: "订单", icon: FiShoppingCart, sub: "充值订单与退款" },
      { key: "packages", label: "套餐", icon: FiBox, sub: "价格档位配置" },
      { key: "redeem", label: "兑换码", icon: FiGift, sub: "批量生成与核销" },
    ],
  },
  {
    group: "运营",
    items: [
      { key: "assets", label: "内容巡查", icon: FiImage, sub: "生成内容审查" },
      { key: "audit", label: "审计日志", icon: FiFileText, sub: "管理操作留痕" },
    ],
  },
];

const ITEMS = NAV.flatMap((g) => g.items);
const META = Object.fromEntries(ITEMS.map((i) => [i.key, i]));

// 与 not-found.js 一致的「页面不存在」（不暴露这是管理入口）。
// 文案必须走 COPY[lang].notFound：原来硬编码中文，英文用户看到的伪装页与真 404 不一致，等于自曝有东西被藏起来了。
function NotFoundDisguise() {
  const { lang } = useLang();
  const t = COPY[lang].notFound;
  return (
    <div className="min-h-dvh grid-bg flex flex-col items-center justify-center gap-6 px-6 text-center">
      <PicsmithMark size={40} className="text-white" />
      <div className="micro-label">// 404 · NOT_FOUND</div>
      <h1 className="font-display text-4xl sm:text-6xl font-extrabold tracking-tight">{t.title}</h1>
      <p className="text-secondary-text text-sm max-w-sm">{t.desc}</p>
      <div className="flex gap-3 mt-2">
        <Link href="/" className="px-6 py-2.5 bg-white text-black rounded-sm text-[11px] font-bold uppercase tracking-[0.15em] hover:bg-gray-200 transition-all">{t.home}</Link>
        <Link href="/dashboard" className="px-6 py-2.5 border border-white/15 bg-white/5 text-gray-400 rounded-sm text-[11px] font-bold uppercase tracking-[0.15em] hover:text-white hover:border-white/30 transition-all">{t.dash}</Link>
      </div>
    </div>
  );
}

// 指标卡：左侧图标块 + 数值 + 副标（对齐参考后台的卡片质感）
function StatCard({ icon: Icon, label, value, hint }) {
  return (
    <div className={`${cardCls} px-5 py-4 flex items-center gap-4`}>
      <div className="w-10 h-10 rounded-sm bg-white/[0.05] border border-white/10 flex items-center justify-center text-gray-300 shrink-0">
        <Icon size={17} />
      </div>
      <div className="flex flex-col gap-0.5 min-w-0">
        <div className="micro-label text-gray-500">{label}</div>
        <div className="font-data text-2xl leading-none">{value}</div>
        {hint ? <div className="text-[11px] text-gray-600 font-mono truncate">{hint}</div> : null}
      </div>
    </div>
  );
}

function Overview({ metrics, series }) {
  const jobs = metrics?.jobs_24h || {};
  const jobsTotal = Object.values(jobs).reduce((a, b) => a + (b || 0), 0);
  const successRate = jobsTotal > 0 ? Math.round(((jobs.done || 0) / jobsTotal) * 100) : 0;
  return (
    <div className="flex flex-col gap-8">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <StatCard icon={FiUsers} label="总用户" value={metrics.users_total ?? "—"} />
        <StatCard icon={FiUserPlus} label="7 日新增" value={metrics.users_new_7d ?? "—"} />
        <StatCard icon={FiActivity} label="24H 任务成功率" value={`${successRate}%`} hint={`${jobs.done || 0}/${jobsTotal}`} />
        <StatCard icon={FiZap} label="24H 积分消耗" value={metrics.credits_consumed_24h ?? "—"} />
        <StatCard icon={FiDollarSign} label="累计收入" value={fmtMoney(metrics.revenue_cents_total)} hint={`${metrics.orders_paid_total ?? 0} 笔已付`} />
        <StatCard icon={FiHardDrive} label="存储用量" value={fmtBytes(metrics.storage_bytes_total)} />
      </div>
      {series?.length ? (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <MiniBars label="近 30 天 · 注册" data={series.map((d) => d.signups)} color="white" />
          <MiniBars label="近 30 天 · 积分消耗" data={series.map((d) => d.credits_consumed)} color="gray" />
          <MiniBars label="近 30 天 · 收入" data={series.map((d) => d.revenue_cents)} color="emerald" format={(c) => fmtMoney(c)} />
        </div>
      ) : null}
    </div>
  );
}

export default function AdminPage() {
  const [state, setState] = useState("loading"); // loading | denied | error | ready
  const [metrics, setMetrics] = useState(null);
  const [series, setSeries] = useState(null);
  const [me, setMe] = useState(null);
  const [tab, setTab] = useState("overview");
  const [navOpen, setNavOpen] = useState(false);   // 移动抽屉
  const [collapsed, setCollapsed] = useState(false); // 桌面侧边栏收起为图标条

  const fetchOverview = useCallback(() => {
    setState("loading");
    adminGet("/metrics")
      .then(({ data }) => { setMetrics(data); setState("ready"); })
      .catch((err) => {
        // 只有 401/403（未登录/非管理员）才伪装 404：伪装只为对外藏入口。
        // 网络断/5xx 也伪装的话，真管理员会误以为后台被下线且无从重试——那是自伤。
        const code = err?.response?.status;
        setState(code === 401 || code === 403 ? "denied" : "error");
      });
    // 趋势图是增强信息：失败可容忍（series 为空时区块自动隐藏），不阻塞整页
    adminGet("/metrics/timeseries?days=30").then(({ data }) => setSeries(data)).catch(() => {});
  }, []);

  useEffect(() => {
    fetchOverview();
    axios.get(`${API}/api/v1/auth/me`).then(({ data }) => setMe(data)).catch(() => {});
  }, [fetchOverview]);

  if (state === "loading") {
    return <div className="min-h-dvh bg-bg-page flex items-center justify-center"><div className="micro-label animate-pulse">// LOADING</div></div>;
  }
  if (state === "denied") return <NotFoundDisguise />;
  if (state === "error") {
    // error ≠ denied：这是给真管理员看的可重试失败页，不做伪装
    return (
      <div className="min-h-dvh bg-bg-page flex flex-col items-center justify-center gap-4 px-6 text-center">
        <div className="micro-label text-red-400">// METRICS_LOAD_FAILED</div>
        <p className="text-[13px] text-gray-400">概览数据加载失败，请检查网络后重试。</p>
        <button onClick={fetchOverview} className={btnGhost}>重试</button>
      </div>
    );
  }

  const role = me?.role || "user";
  const readOnly = role === "support";
  const go = (key) => { setTab(key); setNavOpen(false); };
  const cur = META[tab] || {};
  const initials = (me?.email || "AD").slice(0, 2).toUpperCase();

  const Sidebar = ({ mobile }) => (
    <nav className="flex flex-col h-full">
      {/* 品牌 */}
      <div className={`h-16 flex items-center border-b border-white/[0.06] ${collapsed && !mobile ? "justify-center px-0" : "px-5 gap-2.5"}`}>
        <PicsmithMark size={22} className="text-white shrink-0" />
        {(!collapsed || mobile) && (
          <div className="flex flex-col leading-none">
            <span className="font-display font-extrabold tracking-tight text-[15px]">PICSMITH</span>
            <span className="micro-label text-gray-600 mt-1">运营控制台</span>
          </div>
        )}
        {mobile && <button onClick={() => setNavOpen(false)} className="ml-auto text-gray-500 hover:text-white"><FiX /></button>}
      </div>

      {/* 分组菜单 */}
      <div className="flex-1 min-h-0 overflow-y-auto py-4 flex flex-col gap-5 scrollbar-subtle">
        {NAV.map((g, gi) => (
          <div key={gi} className="flex flex-col gap-1 px-3">
            {g.group && (!collapsed || mobile) ? <div className="micro-label px-2 pb-1 text-gray-600">{g.group}</div> : null}
            {g.items.map((it) => {
              const Icon = it.icon;
              const active = tab === it.key;
              return (
                <button
                  key={it.key}
                  onClick={() => go(it.key)}
                  title={collapsed && !mobile ? it.label : undefined}
                  className={`relative flex items-center rounded-sm transition-all ${collapsed && !mobile ? "justify-center px-0 py-2.5" : "gap-3 px-3 py-2"} ${
                    active ? "bg-white/[0.08] text-white" : "text-gray-500 hover:text-gray-200 hover:bg-white/[0.03]"
                  }`}
                >
                  {/* 选中态左侧白色强调条（替代参考图的橙色块，贴合单色品牌） */}
                  {active ? <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-full bg-white" /> : null}
                  <Icon size={16} className="shrink-0" />
                  {(!collapsed || mobile) && <span className="text-[13px] font-medium tracking-tight">{it.label}</span>}
                </button>
              );
            })}
          </div>
        ))}
      </div>

      {/* 底部：收起 + 退出 */}
      <div className="border-t border-white/[0.06] p-3 flex flex-col gap-1">
        {!mobile && (
          <button onClick={() => setCollapsed((c) => !c)} className={`flex items-center rounded-sm text-gray-500 hover:text-white hover:bg-white/[0.03] transition-all ${collapsed ? "justify-center px-0 py-2" : "gap-3 px-3 py-2"}`}>
            {collapsed ? <FiChevronRight size={16} /> : <><FiChevronLeft size={16} /><span className="text-[12px]">收起</span></>}
          </button>
        )}
        <Link href="/dashboard" className={`flex items-center rounded-sm text-gray-500 hover:text-white hover:bg-white/[0.03] transition-all ${collapsed && !mobile ? "justify-center px-0 py-2" : "gap-3 px-3 py-2"}`}>
          <FiLogOut size={16} />
          {(!collapsed || mobile) && <span className="text-[12px]">返回工作台</span>}
        </Link>
      </div>
    </nav>
  );

  return (
    <SudoProvider>
      <div className="min-h-dvh bg-bg-page text-primary-text flex">
        {/* 桌面侧边栏（用 max-md:hidden 而非 hidden md:flex：本项目 Tailwind v4 下 base hidden 会压过 md:flex） */}
        <aside className={`flex max-md:hidden shrink-0 flex-col bg-black/30 border-r border-white/[0.06] sticky top-0 h-dvh transition-all duration-200 ${collapsed ? "w-16" : "w-60"}`}>
          <Sidebar mobile={false} />
        </aside>

        {/* 移动抽屉 */}
        {navOpen ? (
          <div className="md:hidden fixed inset-0 z-50 flex">
            <div className="w-64 bg-bg-page border-r border-white/[0.06]"><Sidebar mobile /></div>
            <div className="flex-1 bg-black/60" onClick={() => setNavOpen(false)} />
          </div>
        ) : null}

        {/* 主列 */}
        <div className="flex-1 min-w-0 flex flex-col">
          {/* 顶栏：左标题+副标，右身份簇 */}
          <header className="h-16 shrink-0 border-b border-white/[0.06] px-5 sm:px-7 flex items-center gap-4 sticky top-0 bg-bg-page/80 backdrop-blur z-30">
            <button className="md:hidden text-gray-400 hover:text-white" onClick={() => setNavOpen(true)}><FiMenu size={18} /></button>
            <div className="flex flex-col min-w-0">
              <h1 className="font-display text-lg font-extrabold tracking-tight leading-none">{cur.label}</h1>
              {cur.sub ? <span className="text-[11px] text-gray-600 mt-1 truncate">{cur.sub}</span> : null}
            </div>
            <div className="ml-auto flex items-center gap-3">
              <span className={`px-2.5 py-1 rounded-sm border text-[9px] font-bold uppercase tracking-[0.15em] font-mono ${readOnly ? "border-amber-500/40 text-amber-400 bg-amber-500/10" : "border-white/20 text-white bg-white/[0.06]"}`}>
                {readOnly ? "Support · 只读" : "Admin"}
              </span>
              <div className="flex max-sm:hidden items-center gap-2.5 pl-3 border-l border-white/[0.08]">
                <div className="w-8 h-8 rounded-full bg-white/[0.06] border border-white/10 flex items-center justify-center text-[11px] font-bold font-mono text-gray-300">{initials}</div>
                <div className="flex flex-col leading-none">
                  <span className="text-[12px] text-gray-200 font-medium max-w-[160px] truncate">{me?.email || "—"}</span>
                  <span className="micro-label text-gray-600 mt-0.5">{role}</span>
                </div>
              </div>
            </div>
          </header>

          <main className="flex-1 min-h-0 overflow-y-auto px-5 sm:px-7 py-7 scrollbar-subtle">
            <div className="max-w-6xl">
              {tab === "overview" && <Overview metrics={metrics} series={series} />}
              {tab === "users" && <UsersTab readOnly={readOnly} />}
              {tab === "orders" && <OrdersTab readOnly={readOnly} />}
              {tab === "packages" && <PackagesTab readOnly={readOnly} />}
              {tab === "redeem" && <RedeemTab readOnly={readOnly} />}
              {tab === "assets" && <AssetsTab readOnly={readOnly} />}
              {tab === "audit" && <AuditTab />}
            </div>
          </main>
        </div>
      </div>
    </SudoProvider>
  );
}
