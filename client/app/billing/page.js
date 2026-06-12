"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import axios from "axios";
import toast from "react-hot-toast";
import Navbar from "@/components/Navbar";
import { useApi } from "@/context/ApiContext";

const API = process.env.NEXT_PUBLIC_API_BASE || "http://127.0.0.1:8000";

const KIND_LABEL = {
  grant: "赠送", purchase: "充值", reserve: "生成预扣", refund: "失败退还", settle: "结算",
};

export default function BillingPage() {
  const { userData, fetchUserData } = useApi();
  const [packages, setPackages] = useState([]);
  const [paymentsEnabled, setPaymentsEnabled] = useState(false);
  const [ledger, setLedger] = useState([]);
  const [buying, setBuying] = useState(null);

  useEffect(() => {
    axios.get(`${API}/api/v1/billing/packages`).then(({ data }) => {
      setPackages(data.packages);
      setPaymentsEnabled(data.payments_enabled);
    }).catch(() => {});
    axios.get(`${API}/api/v1/billing/ledger`).then(({ data }) => setLedger(data)).catch(() => {});
    const params = new URLSearchParams(window.location.search);
    if (params.get("paid")) {
      toast.success("支付成功，积分已到账");
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

  return (
    <div className="min-h-dvh bg-bg-page text-primary-text">
      <Navbar />
      <main className="max-w-4xl mx-auto px-6 py-12 flex flex-col gap-12">
        <div className="flex items-end justify-between">
          <div className="flex flex-col gap-2">
            <div className="micro-label">// BILLING</div>
            <h1 className="font-display text-3xl font-extrabold tracking-tight">积分与充值</h1>
          </div>
          <div className="text-right">
            <div className="micro-label">当前余额</div>
            <div className="font-display text-4xl font-extrabold">{userData?.balance ?? "—"}</div>
          </div>
        </div>

        {/* 套餐 */}
        <div className="grid sm:grid-cols-3 gap-5">
          {packages.map((p) => (
            <div key={p.id} className="bg-bg-card border border-white/[0.08] rounded-sm p-6 flex flex-col gap-3 hover:border-white/20 transition-all">
              <div className="micro-label">{p.label}</div>
              <div className="font-display text-3xl font-extrabold">{p.credits.toLocaleString()}<span className="text-sm text-gray-500 ml-1">credits</span></div>
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
                {paymentsEnabled ? (buying === p.id ? "跳转中…" : "购买") : "支付通道开通中"}
              </button>
            </div>
          ))}
        </div>

        {/* 用量流水 */}
        <div className="flex flex-col gap-4">
          <div className="micro-label">// LEDGER · 最近 30 条</div>
          <div className="bg-bg-card border border-white/[0.08] rounded-sm divide-y divide-white/[0.05]">
            {ledger.length === 0 && (
              <div className="px-5 py-6 text-[13px] text-gray-600">还没有流水记录</div>
            )}
            {ledger.map((r, i) => (
              <div key={i} className="px-5 py-3 flex items-center gap-4 text-[12px]">
                <span className="micro-label w-20 shrink-0">{KIND_LABEL[r.kind] || r.kind}</span>
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

        <Link href="/dashboard" className="micro-label hover:text-white transition-colors">// 返回工作台</Link>
      </main>
    </div>
  );
}
