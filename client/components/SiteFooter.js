"use client";
import Link from "next/link";
import { PicsmithMark } from "@/components/Logo";
import { useLang } from "@/context/LanguageContext";
import { COPY, SUPPORT_EMAIL } from "@/lib/copy";

export function LangSwitch({ className = "" }) {
  const { lang, setLang } = useLang();
  return (
    <span className={`inline-flex border border-white/10 rounded-sm overflow-hidden ${className}`}>
      {["zh", "en"].map((l) => (
        <button
          key={l}
          onClick={() => setLang(l)}
          className={`px-2.5 py-1 text-[9px] font-mono font-bold uppercase tracking-[0.15em] transition-all ${
            lang === l ? "bg-white text-black" : "bg-transparent text-gray-500 hover:text-white"
          }`}
        >
          {l === "zh" ? "中" : "EN"}
        </button>
      ))}
    </span>
  );
}

export default function SiteFooter() {
  const { lang } = useLang();
  const t = COPY[lang].footer;
  return (
    <footer className="border-t border-white/[0.06] px-6 sm:px-10 py-10">
      <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-6">
        <span className="flex items-center gap-2.5">
          <PicsmithMark size={18} className="text-white" />
          <span className="font-display text-base font-extrabold tracking-tighter brand-gradient-text">Picsmith</span>
          <span className="micro-label hidden sm:inline">{COPY[lang].tagline}</span>
        </span>
        <div className="flex items-center gap-4 micro-label flex-wrap justify-center">
          <Link href="/legal/terms" className="hover:text-white transition-colors">{t.terms}</Link>
          <Link href="/legal/privacy" className="hover:text-white transition-colors">{t.privacy}</Link>
          <Link href="/legal/refund" className="hover:text-white transition-colors">{t.refund}</Link>
          <a href={`mailto:${SUPPORT_EMAIL}`} className="hover:text-white transition-colors">{t.support}</a>
          <LangSwitch />
          <span>© 2026 PICSMITH</span>
        </div>
      </div>
    </footer>
  );
}
