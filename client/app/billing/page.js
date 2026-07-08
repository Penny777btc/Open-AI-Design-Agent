"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import axios from "axios";
import toast from "react-hot-toast";
import Navbar from "@/components/Navbar";
import { useApi } from "@/context/ApiContext";
import { useLang } from "@/context/LanguageContext";
import { COPY } from "@/lib/copy";
import SiteFooter from "@/components/SiteFooter";

const API = process.env.NEXT_PUBLIC_API_BASE || "";

/* 历史流水 memo 的中文兜底映射（保守处理）：
   后端已把新写入的 memo 中文化，但数据库里存量流水仍是英文模板
   （见 server 端 "signup grant" / "purchase N credits" 等写入点）。
   只在中文站按「已知模板精确/正则匹配」翻译，未命中原样透出，绝不猜译。 */
const MEMO_ZH_EXACT = {
  "signup grant": "注册赠送",
  "runtime lost": "运行中断，积分退还",
  "server restart: unused reserve": "服务重启，未使用预扣已退还",
};
const MEMO_ZH_PATTERNS = [
  [/^purchase (\d+) credits$/, (m) => `充值 ${m[1]} 积分`],
  [/^reserve (\d+) for plan$/, (m) => `生成计划预扣 ${m[1]} 积分`],
  [/^region edit (\S+)$/, (m) => `局部编辑 ${m[1]}`],
];
function localizeMemo(memo, lang) {
  if (!memo || lang !== "zh") return memo; // 英文站/空 memo 不动
  const exact = MEMO_ZH_EXACT[memo];
  if (exact) return exact;
  for (const [re, fmt] of MEMO_ZH_PATTERNS) {
    const m = memo.match(re);
    if (m) return fmt(m);
  }
  return memo;
}

export default function BillingPage() {
  const { userData, fetchUserData } = useApi();
  const { lang } = useLang();
  const t = COPY[lang].billing;
  const [packages, setPackages] = useState([]);
  const [paymentsEnabled, setPaymentsEnabled] = useState(false);
  const [ledger, setLedger] = useState([]);
  // 套餐/流水各自三态（loading / ready / error），对齐 dashboard 的 sessionsState 范式：
  // 之前静默 catch + 初值 []，断网时套餐区整块消失、流水区伪装成「还没有流水」，全是误导
  const [packagesState, setPackagesState] = useState("loading");
  const [ledgerState, setLedgerState] = useState("loading");
  const [buying, setBuying] = useState(null);
  const [redeemCode, setRedeemCode] = useState("");
  const [redeeming, setRedeeming] = useState(false);

  const fetchPackages = useCallback(async () => {
    // 重试入口也走这里：先回 loading 让骨架重新出现
    setPackagesState("loading");
    try {
      const { data } = await axios.get(`${API}/api/v1/billing/packages`);
      setPackages(data.packages);
      setPaymentsEnabled(data.payments_enabled);
      setPackagesState("ready");
    } catch {
      setPackagesState("error");
    }
  }, []);

  const fetchLedger = useCallback(async () => {
    setLedgerState("loading");
    try {
      const { data } = await axios.get(`${API}/api/v1/billing/ledger`);
      setLedger(data);
      setLedgerState("ready");
    } catch {
      setLedgerState("error");
    }
  }, []);

  useEffect(() => {
    fetchPackages();
    fetchLedger();
  }, [fetchPackages, fetchLedger]);

  // ?paid 支付回跳 toast：不能在首帧就弹——SSR 兜底下 lang 首帧恒为 "en"，
  // 中文用户从 Stripe 回来会看到英文 "Payment successful"。
  // 做法：effect 依赖 lang 并把弹 toast 推迟一个宏任务；LanguageProvider 的语言检测
  // effect（父组件，晚于子组件执行）会在同一次提交里跑完，若 lang 因此变化，
  // cleanup 取消旧 timer，由携带最终语言的下一次 effect 弹出；ref 防重复弹。
  const paidToastShown = useRef(false);
  useEffect(() => {
    if (paidToastShown.current) return;
    const params = new URLSearchParams(window.location.search);
    if (!params.get("paid")) return;
    const timer = setTimeout(() => {
      paidToastShown.current = true;
      toast.success(COPY[lang].billing.paid);
      fetchUserData();
      window.history.replaceState(null, "", "/billing");
    }, 0);
    return () => clearTimeout(timer);
  }, [lang, fetchUserData]);

  const buy = async (id) => {
    setBuying(id);
    try {
      const { data } = await axios.post(`${API}/api/v1/billing/checkout`, { package_id: id });
      window.location.href = data.checkout_url;
    } catch (err) {
      toast.error(err.response?.data?.detail || t.checkoutFailed);
      setBuying(null);
    }
  };

  const redeem = async () => {
    const code = redeemCode.trim();
    if (!code) return;
    setRedeeming(true);
    try {
      const { data } = await axios.post(`${API}/api/v1/billing/redeem`, { code });
      toast.success(t.redeem.success(data.credits));
      setRedeemCode("");
      fetchUserData(); // 刷新顶部余额
      fetchLedger(); // 复用带三态的拉取：失败会进入 error 态而不是静默丢失
    } catch (err) {
      toast.error(err.response?.data?.detail || t.redeem.failed);
    } finally {
      setRedeeming(false);
    }
  };

  return (
    <div className="min-h-dvh bg-bg-page text-primary-text">
      <Navbar />
      <main className="max-w-4xl mx-auto px-6 py-12 flex flex-col gap-12">
        <div className="flex items-end justify-between">
          <div className="flex flex-col gap-2">
            <div className="micro-label">{t.kicker}</div>
            <h1 className="font-display text-3xl font-extrabold tracking-tight">{t.title}</h1>
          </div>
          <div className="text-right">
            <div className="micro-label">{t.balance}</div>
            <div className="font-data text-4xl">{userData?.balance ?? "—"}</div>
            {userData?.balance > 0 && (
              <div className="text-secondary-text text-[11px] mt-1">
                {/* 积分→图数换算令牌化：双语文案统一维护在 copy.js，避免页面内再出现术语分叉 */}
                {t.approxImages(Math.floor(userData.balance / 10))}
              </div>
            )}
          </div>
        </div>

        {/* 套餐：三态渲染。error 时保留区块并给重试入口，而不是让整个购买区从页面上消失 */}
        {packagesState === "error" ? (
          <div className="bg-bg-card border border-white/[0.08] rounded-sm px-6 py-10 flex flex-col items-center gap-3">
            <div className="text-[13px] text-gray-400">{t.packagesError}</div>
            <button
              onClick={fetchPackages}
              className="px-5 py-2 border border-white/15 bg-white/5 text-gray-300 rounded-sm text-[11px] font-bold uppercase tracking-[0.15em] hover:text-white hover:border-white/30 transition-all"
            >
              {t.retry}
            </button>
          </div>
        ) : (
        <div className="grid sm:grid-cols-3 gap-5">
          {/* loading：骨架卡占位，避免「先空后闪现」 */}
          {packagesState === "loading" && Array.from({ length: 3 }).map((_, i) => (
            <div key={`pkg-skeleton-${i}`} className="bg-bg-card border border-white/[0.08] rounded-sm h-56 animate-pulse" />
          ))}
          {packages.map((p) => (
            <div key={p.id} className="bg-bg-card border border-white/[0.08] rounded-sm p-6 flex flex-col gap-3 hover:border-white/20 transition-all">
              <div className="micro-label">{p.label}</div>
              {/* 单位不再写死 "credits"：中文站显示「积分」，避免 $ / credits / 积分 同屏三写 */}
              <div className="font-data text-3xl">{p.credits.toLocaleString()}<span className="text-sm text-gray-500 ml-1 font-normal">{t.unit}</span></div>
              <div className="text-secondary-text text-[11px] -mt-1">
                {t.approxImages(Math.floor(p.credits / 10).toLocaleString())}
              </div>
              <div className="text-secondary-text text-[13px]">${(p.amount_cents / 100).toFixed(2)}</div>
              <button
                onClick={() => buy(p.id)}
                disabled={!paymentsEnabled || buying === p.id}  // 支付未开通就真禁用，避免点了报「下单失败」与「开通中」文案自相矛盾
                className={`mt-2 py-2.5 rounded-sm text-[11px] font-bold uppercase tracking-[0.15em] transition-all ${
                  paymentsEnabled
                    ? "bg-white text-black hover:bg-gray-200"
                    : "border border-white/10 text-gray-500 cursor-not-allowed"
                }`}
              >
                {paymentsEnabled ? (buying === p.id ? t.buying : t.buy) : t.pending}
              </button>
            </div>
          ))}
        </div>
        )}

        {/* 支付未开通的运营兜底：按钮只显「开通中」会让付费意愿空转，
            这里衔接到下方兑换码 / 注册赠送积分，给用户一条马上能走的路 */}
        {packagesState === "ready" && !paymentsEnabled && (
          <div className="text-secondary-text text-[12px] -mt-8">{t.pendingHint}</div>
        )}

        {/* 兑换码 */}
        <div className="flex flex-col gap-3">
          <div className="micro-label">{t.redeem.label}</div>
          <div className="bg-bg-card border border-white/[0.08] rounded-sm p-5 flex flex-col sm:flex-row gap-3 sm:items-center">
            <input
              value={redeemCode}
              onChange={(e) => setRedeemCode(e.target.value.toUpperCase())}
              onKeyDown={(e) => { if (e.key === "Enter" && !redeeming) redeem(); }}
              placeholder={t.redeem.placeholder}
              className="flex-1 px-4 py-2.5 bg-white/[0.02] border border-white/10 rounded-sm text-white placeholder-gray-600 focus:outline-none focus:border-white/30 transition-all font-mono text-sm"
            />
            <button
              onClick={redeem}
              disabled={redeeming || !redeemCode.trim()}
              className="py-2.5 px-6 rounded-sm text-[11px] font-bold uppercase tracking-[0.15em] bg-white text-black hover:bg-gray-200 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {redeeming ? t.redeem.redeeming : t.redeem.button}
            </button>
          </div>
        </div>

        {/* 用量流水 */}
        <div className="flex flex-col gap-4">
          <div className="micro-label">{t.ledger}</div>
          <div className="bg-bg-card border border-white/[0.08] rounded-sm divide-y divide-white/[0.05]">
            {/* 三态之 loading：骨架行。之前初值 [] 直接命中「还没有流水」，加载中被当成空 */}
            {ledgerState === "loading" && Array.from({ length: 3 }).map((_, i) => (
              <div key={`ledger-skeleton-${i}`} className="px-5 py-4">
                <div className="h-3 w-2/3 bg-white/[0.06] rounded animate-pulse" />
              </div>
            ))}
            {/* 三态之 error：请求失败 ≠ 没有流水，给重试而不是误导用户「消费记录没了」 */}
            {ledgerState === "error" && (
              <div className="px-5 py-6 flex items-center gap-4 text-[13px] text-gray-500">
                <span>{t.ledgerError}</span>
                <button
                  onClick={fetchLedger}
                  className="px-4 py-1.5 border border-white/15 bg-white/5 text-gray-300 rounded-sm text-[10px] font-bold uppercase tracking-[0.15em] hover:text-white hover:border-white/30 transition-all"
                >
                  {t.retry}
                </button>
              </div>
            )}
            {/* 三态之 empty：确认加载成功且确实没有流水，才显示空态文案 */}
            {ledgerState === "ready" && ledger.length === 0 && (
              <div className="px-5 py-6 text-[13px] text-gray-600">{t.empty}</div>
            )}
            {ledgerState === "ready" && ledger.map((r, i) => (
              <div key={i} className="px-5 py-3 flex items-center gap-4 text-[12px]">
                {/* kind 未命中不裸奔枚举值（后端新增 kind 时中文站会漏英文），统一显示「其他/Other」 */}
                <span className="micro-label w-20 shrink-0">{t.kinds[r.kind] || t.kindOther}</span>
                <span className={`font-mono font-bold w-16 ${r.delta >= 0 ? "text-white" : "text-gray-500"}`}>
                  {r.delta >= 0 ? `+${r.delta}` : r.delta}
                </span>
                {/* 存量英文 memo 在中文站做已知模板映射（见文件头 localizeMemo），未知内容原样透出 */}
                <span className="text-gray-500 flex-1 truncate">{localizeMemo(r.memo, lang)}</span>
                <span className="font-mono text-gray-600">→ {r.balance_after}</span>
                <span className="text-gray-700 font-mono hidden sm:inline">{new Date(r.created_at).toLocaleString()}</span>
              </div>
            ))}
          </div>
        </div>

        <Link href="/dashboard" className="micro-label hover:text-white transition-colors">{t.back}</Link>
      </main>
      <SiteFooter />
    </div>
  );
}
