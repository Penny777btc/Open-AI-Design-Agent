"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import axios from "axios";
import toast from "react-hot-toast";
import { PicsmithMark } from "@/components/Logo";
import { LangSwitch } from "@/components/SiteFooter";
import { useApi } from "@/context/ApiContext";
import { useLang } from "@/context/LanguageContext";
import { COPY } from "@/lib/copy";

const API = process.env.NEXT_PUBLIC_API_BASE || "http://127.0.0.1:8000";

export default function RegisterPage() {
  const router = useRouter();
  const { fetchUserData } = useApi();
  const { lang } = useLang();
  const t = COPY[lang].auth;
  const tf = COPY[lang].footer;
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);

  const inputCls = "w-full px-4 py-3 bg-white/[0.02] border border-white/10 rounded-sm text-white placeholder-gray-600 focus:outline-none focus:border-white/30 transition-all font-mono text-sm";

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    if (!agreed) {
      toast.error(t.mustAgree);
      return;
    }
    setBusy(true);
    try {
      const { data } = await axios.post(`${API}/api/v1/auth/register`, {
        email, password, name: name || undefined,
      });
      localStorage.setItem("token", data.token);
      await fetchUserData();
      toast.success(t.welcome(data.user.balance));
      router.push("/dashboard");
    } catch (err) {
      toast.error(err.response?.data?.detail || "Register failed");
      setBusy(false);
    }
  };

  return (
    <div className="min-h-dvh grid-bg flex flex-col items-center justify-center px-6 gap-8">
      <Link href="/" className="flex items-center gap-3">
        <PicsmithMark size={36} className="text-white" />
        <span className="font-display text-3xl font-extrabold tracking-tighter brand-gradient-text">Picsmith</span>
      </Link>
      <div className="micro-label">{t.registerTitle}</div>
      <div className="w-full max-w-sm bg-bg-card border border-white/10 rounded-sm p-8 shadow-[0_0_50px_rgba(0,0,0,0.5)] flex flex-col gap-6">
        <form onSubmit={submit} className="flex flex-col gap-4 w-full">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t.name} className={inputCls} />
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t.email} className={inputCls} />
          <input type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} placeholder={t.passwordHint} className={inputCls} />
          {/* 同意条款（上线合规必备） */}
          <label className="flex items-start gap-2.5 text-[11px] text-gray-500 cursor-pointer select-none leading-relaxed">
            <input
              type="checkbox"
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
              className="mt-0.5 accent-white"
            />
            <span>
              {t.agreePrefix}{" "}
              <Link href="/legal/terms" target="_blank" className="text-white hover:underline">{tf.terms}</Link>{" "}
              {t.and}{" "}
              <Link href="/legal/privacy" target="_blank" className="text-white hover:underline">{tf.privacy}</Link>
            </span>
          </label>
          <button type="submit" disabled={busy || !agreed}
            className="w-full py-3 bg-white text-black rounded-sm text-[12px] font-bold uppercase tracking-[0.15em] hover:bg-gray-200 transition-all disabled:opacity-50">
            {busy ? t.registering : t.register}
          </button>
        </form>
        <div className="text-center text-[12px] text-gray-500">
          {t.hasAccount} <Link href="/login" className="text-white hover:underline">{t.loginLink}</Link>
        </div>
      </div>
      <div className="flex items-center gap-4">
        <Link href="/" className="micro-label hover:text-white transition-colors">{t.backHome}</Link>
        <LangSwitch />
      </div>
    </div>
  );
}
