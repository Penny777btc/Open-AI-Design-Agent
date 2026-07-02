"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import axios from "axios";
import toast from "react-hot-toast";
import { PicsmithMark } from "@/components/Logo";
import { useLang } from "@/context/LanguageContext";
import { COPY } from "@/lib/copy";

const API = process.env.NEXT_PUBLIC_API_BASE || "";

/* 本页原来整页写死中文：海外先行策略下，英文用户点重置邮件链接会中途掉进中文。
   文案全部收进 copy.js 的 reset 段，跟随 useLang 双语切换。 */
function ResetFlow() {
  const router = useRouter();
  const token = useSearchParams().get("token");
  const { lang } = useLang();
  const t = COPY[lang].reset;
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  const inputCls = "w-full px-4 py-3 bg-white/[0.02] border border-white/10 rounded-sm text-white placeholder-gray-600 focus:outline-none focus:border-white/30 transition-all font-mono text-sm";
  const btnCls = "w-full py-3 bg-white text-black rounded-sm text-[12px] font-bold uppercase tracking-[0.15em] hover:bg-gray-200 transition-all disabled:opacity-50";

  // 有 token：设置新密码；无 token：请求重置邮件
  if (token) {
    const submit = async (e) => {
      e.preventDefault();
      setBusy(true);
      try {
        const { data } = await axios.post(`${API}/api/v1/auth/reset`, { token, password });
        localStorage.setItem("token", data.token);
        toast.success(t.resetDone);
        router.push("/dashboard");
      } catch (err) {
        toast.error(err.response?.data?.detail || t.resetFailed);
        setBusy(false);
      }
    };
    return (
      <form onSubmit={submit} className="flex flex-col gap-4 w-full">
        <input type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)}
          placeholder={t.newPassword} className={inputCls} />
        <button type="submit" disabled={busy} className={btnCls}>{busy ? t.submitting : t.submitNew}</button>
      </form>
    );
  }

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await axios.post(`${API}/api/v1/auth/request-reset`, { email });
      setSent(true);
    } catch (err) {
      toast.error(err.response?.data?.detail || t.requestFailed);
    } finally {
      setBusy(false);
    }
  };
  if (sent) {
    return (
      <p className="text-[13px] text-secondary-text text-center leading-relaxed">
        {t.sentLine1}<br />{t.sentLine2}
      </p>
    );
  }
  return (
    <form onSubmit={submit} className="flex flex-col gap-4 w-full">
      <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
        placeholder={t.emailPlaceholder} className={inputCls} />
      <button type="submit" disabled={busy} className={btnCls}>{busy ? t.sending : t.send}</button>
    </form>
  );
}

export default function ResetPage() {
  const { lang } = useLang();
  const t = COPY[lang].reset;
  return (
    <div className="min-h-dvh grid-bg flex flex-col items-center justify-center px-6 gap-8">
      <Link href="/" className="flex items-center gap-3">
        <PicsmithMark size={36} className="text-white" />
        <span className="font-display text-3xl font-extrabold tracking-tighter brand-gradient-text">Picsmith</span>
      </Link>
      <div className="micro-label">{t.kicker}</div>
      <div className="w-full max-w-sm bg-bg-card border border-white/10 rounded-sm p-8 shadow-[0_0_50px_rgba(0,0,0,0.5)] flex flex-col gap-6">
        <Suspense fallback={null}>
          <ResetFlow />
        </Suspense>
        <div className="text-center text-[12px] text-gray-500">
          {t.remembered} <Link href="/login" className="text-white hover:underline">{t.backLogin}</Link>
        </div>
      </div>
    </div>
  );
}
