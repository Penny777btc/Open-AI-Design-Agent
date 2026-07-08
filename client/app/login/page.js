"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import axios from "axios";
import toast from "react-hot-toast";
import { PicsmithMark } from "@/components/Logo";
import { LangSwitch } from "@/components/SiteFooter";
import { useApi } from "@/context/ApiContext";
import { useLang } from "@/context/LanguageContext";
import { COPY } from "@/lib/copy";

const API = process.env.NEXT_PUBLIC_API_BASE || "";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { fetchUserData } = useApi();
  const { lang } = useLang();
  const t = COPY[lang].auth;
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const inputCls = "w-full px-4 py-3 bg-white/[0.02] border border-white/10 rounded-sm text-white placeholder-gray-600 focus:outline-none focus:border-white/30 transition-all font-mono text-sm";

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const { data } = await axios.post(`${API}/api/v1/auth/login`, { email, password });
      localStorage.setItem("token", data.token);
      await fetchUserData();
      // 只允许站内相对路径，防开放重定向(?next=https://evil.com 登录后跳外站钓鱼)
      const nxt = searchParams.get("next");
      router.push(nxt && nxt.startsWith("/") && !nxt.startsWith("//") ? nxt : "/dashboard");
    } catch (err) {
      // 兜底错误走 copy.js：中文站不再漏英文 "Login failed"
      toast.error(err.response?.data?.detail || t.loginFailed);
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-4 w-full">
      <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t.email} className={inputCls} />
      <input type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} placeholder={t.password} className={inputCls} />
      <button type="submit" disabled={busy}
        className="w-full py-3 bg-white text-black rounded-sm text-[12px] font-bold uppercase tracking-[0.15em] hover:bg-gray-200 transition-all disabled:opacity-50">
        {busy ? t.loggingIn : t.login}
      </button>
    </form>
  );
}

export default function LoginPage() {
  const { lang } = useLang();
  const t = COPY[lang].auth;
  return (
    <div className="min-h-dvh grid-bg flex flex-col items-center justify-center px-6 gap-8">
      <Link href="/" className="flex items-center gap-3">
        <PicsmithMark size={36} className="text-white" />
        <span className="font-display text-3xl font-extrabold tracking-tighter brand-gradient-text">Picsmith</span>
      </Link>
      <div className="micro-label">{t.loginTitle}</div>
      <div className="w-full max-w-sm bg-bg-card border border-white/10 rounded-sm p-8 shadow-[0_0_50px_rgba(0,0,0,0.5)] flex flex-col gap-6">
        <Suspense fallback={null}>
          <LoginForm />
        </Suspense>
        <div className="text-center text-[12px] text-gray-500 flex flex-col gap-1.5">
          <span>
            {t.noAccount}{" "}
            <Link href="/register" className="text-white hover:underline">{t.registerLink}</Link>
          </span>
          <Link href="/reset" className="text-gray-600 hover:text-white transition-colors">{t.forgot}</Link>
        </div>
      </div>
      <div className="flex items-center gap-4">
        <Link href="/" className="micro-label hover:text-white transition-colors">{t.backHome}</Link>
        <LangSwitch />
      </div>
    </div>
  );
}
