"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useApi } from "@/context/ApiContext";
import { PicsmithMark } from "@/components/Logo";
import { useLang } from "@/context/LanguageContext";
import { COPY } from "@/lib/copy";

const Navbar = () => {
  const { userData, loading, logout } = useApi();
  const { lang } = useLang();
  const t = COPY[lang].navbar;
  const [mounted, setMounted] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <div className="relative w-full">
      <header className="fixed top-0 left-0 right-0 z-[100] flex items-center justify-between px-8 py-4 bg-[#09090b]/90 backdrop-blur-xl border-b border-white/[0.06]">
        <div className="flex items-center gap-8">
          <Link href="/" className="flex items-center gap-2.5 hover:opacity-80 transition-opacity">
            <PicsmithMark size={22} className="text-white" />
            <span className="font-display text-xl font-extrabold text-white tracking-tighter brand-gradient-text">
              Picsmith
            </span>
            <span className="micro-label hidden sm:inline">{t.tagline}</span>
          </Link>
        </div>

        <div className="flex items-center gap-4 justify-end">
          {mounted && !loading && userData && (
            <div className="flex items-center gap-3 relative">
              <Link
                href="/billing"
                title={t.creditsTitle}
                aria-label={t.creditsTitle}
                className="px-3 py-1.5 text-[10px] font-mono font-bold tracking-[0.15em] uppercase border border-white/10 rounded-sm bg-white/5 text-gray-400 hover:border-white/25 hover:text-white transition-all"
              >
                {t.credits}&nbsp;<span className="text-white">{userData.balance ?? 0}</span>
              </Link>
              <button
                onClick={() => setMenuOpen((v) => !v)}
                className="text-[11px] font-mono font-bold uppercase tracking-[0.15em] text-gray-500 hover:text-white transition-colors"
              >
                {userData.username || "User"} ▾
              </button>
              {menuOpen && (
                <div className="absolute top-full right-0 mt-2 w-44 bg-bg-card border border-white/10 rounded-sm shadow-[0_20px_40px_rgba(0,0,0,0.7)] flex flex-col py-1 z-[110]">
                  <span className="px-4 py-2 text-[11px] text-gray-600 font-mono truncate">{userData.email}</span>
                  <Link href="/billing" onClick={() => setMenuOpen(false)} className="px-4 py-2 text-[12px] text-gray-400 hover:text-white hover:bg-white/5 transition-colors">{t.billing}</Link>
                  <Link href="/account" onClick={() => setMenuOpen(false)} className="px-4 py-2 text-[12px] text-gray-400 hover:text-white hover:bg-white/5 transition-colors">{t.account}</Link>
                  <button onClick={logout} className="px-4 py-2 text-[12px] text-left text-gray-400 hover:text-white hover:bg-white/5 transition-colors">{t.logout}</button>
                </div>
              )}
            </div>
          )}
          {mounted && !loading && !userData && (
            <Link
              href="/login"
              className="px-5 py-2 bg-white text-black rounded-sm text-[10px] font-bold uppercase tracking-[0.15em] hover:bg-gray-200 transition-all"
            >
              {t.login}
            </Link>
          )}
        </div>
      </header>
      {/* fixed header 占位 */}
      <div className="h-[57px]" />
    </div>
  );
};

export default Navbar;
