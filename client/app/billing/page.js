"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import axios from "axios";
import toast from "react-hot-toast";
import Navbar from "@/components/Navbar";
import { useApi } from "@/context/ApiContext";
import { useLang } from "@/context/LanguageContext";
import { COPY } from "@/lib/copy";
import SiteFooter from "@/components/SiteFooter";

const API = process.env.NEXT_PUBLIC_API_BASE || "";

export default function BillingPage() {
  const { userData, fetchUserData } = useApi();
  const { lang } = useLang();
  const t = COPY[lang].billing;
  const [packages, setPackages] = useState([]);
  const [paymentsEnabled, setPaymentsEnabled] = useState(false);
  const [ledger, setLedger] = useState([]);
  const [buying, setBuying] = useState(null);
  const [redeemCode, setRedeemCode] = useState("");
  const [redeeming, setRedeeming] = useState(false);

  useEffect(() => {
    axios.get(`${API}/api/v1/billing/packages`).then(({ data }) => {
      setPackages(data.packages);
      setPaymentsEnabled(data.payments_enabled);
    }).catch(() => {});
    axios.get(`${API}/api/v1/billing/ledger`).then(({ data }) => setLedger(data)).catch(() => {});
    const params = new URLSearchParams(window.location.search);
    if (params.get("paid")) {
      toast.success(t.paid);
      fetchUserData();
      window.history.replaceState(null, "", "/billing");
    }
  }, [fetchUserData]);

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
      axios.get(`${API}/api/v1/billing/ledger`).then(({ data }) => setLedger(data)).catch(() => {});
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

        {/* 套餐 */}
        <div className="grid sm:grid-cols-3 gap-5">
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
            {ledger.length === 0 && (
              <div className="px-5 py-6 text-[13px] text-gray-600">{t.empty}</div>
            )}
            {ledger.map((r, i) => (
              <div key={i} className="px-5 py-3 flex items-center gap-4 text-[12px]">
                <span className="micro-label w-20 shrink-0">{t.kinds[r.kind] || r.kind}</span>
                <span className={`font-mono font-bold w-16 ${r.delta >= 0 ? "text-white" : "text-gray-500"}`}>
                  {r.delta >= 0 ? `+${r.delta}` : r.delta}
                </span>
                <span className="text-gray-500 flex-1 truncate">{r.memo}</span>
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
