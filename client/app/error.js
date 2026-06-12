"use client";
import { PicsmithMark } from "@/components/Logo";
import { useLang } from "@/context/LanguageContext";
import { COPY } from "@/lib/copy";

export default function GlobalError({ error, reset }) {
  const { lang } = useLang();
  const t = COPY[lang].error;
  return (
    <div className="min-h-dvh grid-bg flex flex-col items-center justify-center gap-6 px-6 text-center bg-bg-page text-primary-text">
      <PicsmithMark size={40} className="text-white" />
      <div className="micro-label">// 500 · UNEXPECTED_ERROR</div>
      <h1 className="font-display text-4xl font-extrabold tracking-tight">{t.title}</h1>
      <p className="text-secondary-text text-sm max-w-sm">{t.desc}</p>
      <button
        onClick={() => reset()}
        className="px-6 py-2.5 bg-white text-black rounded-sm text-[11px] font-bold uppercase tracking-[0.15em] hover:bg-gray-200 transition-all"
      >
        {t.retry}
      </button>
    </div>
  );
}
