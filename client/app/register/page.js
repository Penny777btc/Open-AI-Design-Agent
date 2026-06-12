"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import axios from "axios";
import toast from "react-hot-toast";
import { PicsmithMark } from "@/components/Logo";
import { useApi } from "@/context/ApiContext";

const API = process.env.NEXT_PUBLIC_API_BASE || "http://127.0.0.1:8000";

export default function RegisterPage() {
  const router = useRouter();
  const { fetchUserData } = useApi();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const { data } = await axios.post(`${API}/api/v1/auth/register`, {
        email, password, name: name || undefined,
      });
      localStorage.setItem("token", data.token);
      await fetchUserData();
      toast.success(`欢迎！已赠送 ${data.user.balance} credits`);
      router.push("/dashboard");
    } catch (err) {
      toast.error(err.response?.data?.detail || "注册失败，请重试");
      setBusy(false);
    }
  };

  return (
    <div className="min-h-dvh grid-bg flex flex-col items-center justify-center px-6 gap-8">
      <Link href="/" className="flex items-center gap-3">
        <PicsmithMark size={36} className="text-white" />
        <span className="font-display text-3xl font-extrabold tracking-tighter brand-gradient-text">Picsmith</span>
      </Link>
      <div className="micro-label">// AUTH_PORTAL · REGISTRY_NEW</div>
      <div className="w-full max-w-sm bg-bg-card border border-white/10 rounded-sm p-8 shadow-[0_0_50px_rgba(0,0,0,0.5)] flex flex-col gap-6">
        <form onSubmit={submit} className="flex flex-col gap-4 w-full">
          <input
            value={name} onChange={(e) => setName(e.target.value)}
            placeholder="NAME（可选）"
            className="w-full px-4 py-3 bg-white/[0.02] border border-white/10 rounded-sm text-white placeholder-gray-600 focus:outline-none focus:border-white/30 transition-all font-mono text-sm"
          />
          <input
            type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
            placeholder="EMAIL"
            className="w-full px-4 py-3 bg-white/[0.02] border border-white/10 rounded-sm text-white placeholder-gray-600 focus:outline-none focus:border-white/30 transition-all font-mono text-sm"
          />
          <input
            type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)}
            placeholder="PASSWORD（至少 8 位）"
            className="w-full px-4 py-3 bg-white/[0.02] border border-white/10 rounded-sm text-white placeholder-gray-600 focus:outline-none focus:border-white/30 transition-all font-mono text-sm"
          />
          <button
            type="submit" disabled={busy}
            className="w-full py-3 bg-white text-black rounded-sm text-[12px] font-bold uppercase tracking-[0.15em] hover:bg-gray-200 transition-all disabled:opacity-50"
          >
            {busy ? "创建中…" : "注册 · 领 200 CREDITS"}
          </button>
        </form>
        <div className="text-center text-[12px] text-gray-500">
          已有账号？ <Link href="/login" className="text-white hover:underline">直接登录 →</Link>
        </div>
      </div>
      <Link href="/" className="micro-label hover:text-white transition-colors">// RETURN_TO_HOME</Link>
    </div>
  );
}
