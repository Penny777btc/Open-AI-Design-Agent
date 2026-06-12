"use client";
import Link from "next/link";
import { PicsmithMark } from "@/components/Logo";
import { useLang } from "@/context/LanguageContext";
import { COPY } from "@/lib/copy";

export default function NotFound() {
  const { lang } = useLang();
  const t = COPY[lang].notFound;
  return (
    <div className="min-h-dvh grid-bg flex flex-col items-center justify-center gap-6 px-6 text-center">
      <PicsmithMark size={40} className="text-white" />
      <div className="micro-label">// 404 · NOT_FOUND</div>
      <h1 className="font-display text-4xl sm:text-6xl font-extrabold tracking-tight">{t.title}</h1>
      <p className="text-secondary-text text-sm max-w-sm">{t.desc}</p>
      <div className="flex gap-3 mt-2">
        <Link href="/" className="px-6 py-2.5 bg-white text-black rounded-sm text-[11px] font-bold uppercase tracking-[0.15em] hover:bg-gray-200 transition-all">
          {t.home}
        </Link>
        <Link href="/dashboard" className="px-6 py-2.5 border border-white/15 bg-white/5 text-gray-400 rounded-sm text-[11px] font-bold uppercase tracking-[0.15em] hover:text-white hover:border-white/30 transition-all">
          {t.dash}
        </Link>
      </div>
    </div>
  );
}
