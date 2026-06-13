"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import axios from "axios";
import toast from "react-hot-toast";
import Navbar from "@/components/Navbar";
import SiteFooter from "@/components/SiteFooter";
import { useApi } from "@/context/ApiContext";
import { useLang } from "@/context/LanguageContext";
import { COPY, SUPPORT_EMAIL } from "@/lib/copy";

const API = process.env.NEXT_PUBLIC_API_BASE || "http://127.0.0.1:8000";

const inputCls = "w-full px-4 py-2.5 bg-white/[0.02] border border-white/10 rounded-sm text-white placeholder-gray-600 focus:outline-none focus:border-white/30 transition-all font-mono text-sm";
const btnCls = "px-5 py-2.5 bg-white text-black rounded-sm text-[11px] font-bold uppercase tracking-[0.15em] hover:bg-gray-200 transition-all disabled:opacity-50";

function Section({ label, children }) {
  return (
    <div className="bg-bg-card border border-white/[0.08] rounded-sm p-6 flex flex-col gap-4">
      <div className="micro-label">{label}</div>
      {children}
    </div>
  );
}

export default function AccountPage() {
  const { userData, fetchUserData, logout } = useApi();
  const { lang } = useLang();
  const t = COPY[lang].account;

  const [name, setName] = useState("");
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [delConfirm, setDelConfirm] = useState("");
  const [delPw, setDelPw] = useState("");
  const [busy, setBusy] = useState(null);
  const [role, setRole] = useState(null); // admin | support | user

  // 取角色用于决定是否渲染管理后台入口（仅 admin / support 可见）。
  useEffect(() => {
    axios
      .get(`${API}/api/v1/auth/me`)
      .then(({ data }) => setRole(data.role || "user"))
      .catch(() => {});
  }, []);

  const saveName = async () => {
    setBusy("name");
    try {
      await axios.patch(`${API}/api/v1/auth/profile`, { name });
      await fetchUserData();
      toast.success(t.saved);
    } catch (err) {
      toast.error(err.response?.data?.detail || "Failed");
    } finally { setBusy(null); }
  };

  const changePw = async () => {
    setBusy("pw");
    try {
      await axios.post(`${API}/api/v1/auth/change-password`, { current_password: currentPw, new_password: newPw });
      setCurrentPw(""); setNewPw("");
      toast.success(t.pwChanged);
    } catch (err) {
      toast.error(err.response?.data?.detail || "Failed");
    } finally { setBusy(null); }
  };

  const sendVerify = async () => {
    setBusy("verify");
    try {
      await axios.post(`${API}/api/v1/auth/send-verification`);
      toast.success("📮 ✓");
    } catch (err) {
      toast.error(err.response?.data?.detail || "Failed");
    } finally { setBusy(null); }
  };

  const deleteAccount = async () => {
    setBusy("delete");
    try {
      await axios.post(`${API}/api/v1/auth/delete-account`, { confirm: delConfirm, password: delPw || undefined });
      toast.success(t.deleted);
      logout();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Failed");
      setBusy(null);
    }
  };

  return (
    <div className="min-h-dvh bg-bg-page text-primary-text flex flex-col">
      <Navbar />
      <main className="max-w-2xl mx-auto px-6 py-12 flex flex-col gap-6 w-full flex-1">
        <div className="flex items-end justify-between">
          <div className="flex flex-col gap-2">
            <div className="micro-label">{t.kicker}</div>
            <h1 className="font-display text-3xl font-extrabold tracking-tight">{t.title}</h1>
          </div>
          <a href={`mailto:${SUPPORT_EMAIL}`} className="micro-label hover:text-white transition-colors">✉ {t.support}</a>
        </div>

        {role === "admin" || role === "support" ? (
          <Link
            href="/admin"
            className="bg-bg-card border border-white/[0.08] rounded-sm p-5 flex items-center justify-between hover:border-white/25 transition-all group"
          >
            <div className="flex flex-col gap-1">
              <div className="micro-label">// ADMIN · 运营控制台</div>
              <span className="text-[14px] text-white">管理后台</span>
            </div>
            <span className="text-gray-500 group-hover:text-white transition-colors text-[11px] font-bold uppercase tracking-[0.15em]">
              进入 →
            </span>
          </Link>
        ) : null}

        <Section label={`${t.profile} · ${userData?.email || ""}`}>
          <div className="flex gap-3">
            <input value={name} onChange={(e) => setName(e.target.value)}
              placeholder={userData?.username || t.nameLabel} className={inputCls} />
            <button onClick={saveName} disabled={busy === "name" || !name.trim()} className={btnCls}>{t.save}</button>
          </div>
        </Section>

        <Section label={t.security}>
          <div className="flex flex-col sm:flex-row gap-3">
            <input type="password" value={currentPw} onChange={(e) => setCurrentPw(e.target.value)}
              placeholder={t.current} className={inputCls} />
            <input type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)}
              placeholder={t.newPw} className={inputCls} />
            <button onClick={changePw} disabled={busy === "pw" || !currentPw || newPw.length < 8} className={`${btnCls} shrink-0`}>
              {t.changePw}
            </button>
          </div>
        </Section>

        <Section label={t.emailStatus}>
          <div className="flex items-center justify-between">
            <span className="text-[13px] text-secondary-text">
              {userData?.email} · <span className="text-gray-600">{t.unverified}</span>
            </span>
            <button onClick={sendVerify} disabled={busy === "verify"}
              className="px-4 py-2 border border-white/15 bg-white/5 text-gray-400 rounded-sm text-[10px] font-bold uppercase tracking-[0.15em] hover:text-white hover:border-white/30 transition-all">
              {t.sendVerify}
            </button>
          </div>
        </Section>

        <Section label={t.danger}>
          <p className="text-[13px] text-secondary-text leading-relaxed">{t.deleteDesc}</p>
          <div className="flex flex-col sm:flex-row gap-3">
            <input value={delConfirm} onChange={(e) => setDelConfirm(e.target.value)}
              placeholder={t.deleteConfirmHint} className={inputCls} />
            <input type="password" value={delPw} onChange={(e) => setDelPw(e.target.value)}
              placeholder={t.deletePw} className={inputCls} />
            <button onClick={deleteAccount} disabled={busy === "delete" || delConfirm !== "DELETE"}
              className="shrink-0 px-5 py-2.5 bg-red-500/15 border border-red-500/40 text-red-400 rounded-sm text-[11px] font-bold uppercase tracking-[0.15em] hover:bg-red-500/25 transition-all disabled:opacity-40">
              {t.deleteBtn}
            </button>
          </div>
        </Section>

        <Link href="/dashboard" className="micro-label hover:text-white transition-colors">// ← STUDIO</Link>
      </main>
      <SiteFooter />
    </div>
  );
}
