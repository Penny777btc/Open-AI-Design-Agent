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

const API = process.env.NEXT_PUBLIC_API_BASE || "http://127.0.0.1:8000";

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
  const zh = lang === "zh";

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
      toast.error(err.response?.data?.detail || "下单失败");
      setBuying(null);
    }
  };

  const redeem = async () => {
    const code = redeemCode.trim();
    if (!code) return;
    setRedeeming(true);
    try {
      const { data } = await axios.post(`${API}/api/v1/billing/redeem`, { code });
      toast.success(zh ? `已到账 ${data.credits} 积分` : `${data.credits} credits added`);
      setRedeemCode("");
      fetchUserData(); // 刷新顶部余额
      axios.get(`${API}/api/v1/billing/ledger`).then(({ data }) => setLedger(data)).catch(() => {});
    } catch (err) {
      toast.error(err.response?.data?.detail || (zh ? "兑换失败" : "Redeem failed"));
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
          </div>
        </div>

        {/* 套餐 */}
        <div className="grid sm:grid-cols-3 gap-5">
          {packages.map((p) => (
            <div key={p.id} className="bg-bg-card border border-white/[0.08] rounded-sm p-6 flex flex-col gap-3 hover:border-white/20 transition-all">
              <div className="micro-label">{p.label}</div>
              <div className="font-data text-3xl">{p.credits.toLocaleString()}<span className="text-sm text-gray-500 ml-1 font-normal">credits</span></div>
              <div className="text-secondary-text text-[13px]">${(p.amount_cents / 100).toFixed(2)}</div>
              <button
                onClick={() => buy(p.id)}
                disabled={buying === p.id}
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
          <div className="micro-label">{zh ? "兑换码" : "Redeem code"}</div>
          <div className="bg-bg-card border border-white/[0.08] rounded-sm p-5 flex flex-col sm:flex-row gap-3 sm:items-center">
            <input
              value={redeemCode}
              onChange={(e) => setRedeemCode(e.target.value.toUpperCase())}
              onKeyDown={(e) => { if (e.key === "Enter" && !redeeming) redeem(); }}
              placeholder={zh ? "输入兑换码，如 PIC-XXXX-XXXX-XXXX-XXXX" : "Enter your code"}
              className="flex-1 px-4 py-2.5 bg-white/[0.02] border border-white/10 rounded-sm text-white placeholder-gray-600 focus:outline-none focus:border-white/30 transition-all font-mono text-sm"
            />
            <button
              onClick={redeem}
              disabled={redeeming || !redeemCode.trim()}
              className="py-2.5 px-6 rounded-sm text-[11px] font-bold uppercase tracking-[0.15em] bg-white text-black hover:bg-gray-200 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {redeeming ? (zh ? "兑换中…" : "Redeeming…") : (zh ? "兑换" : "Redeem")}
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
