import Link from "next/link";
import { PicsmithMark } from "@/components/Logo";

export default function LegalLayout({ children }) {
  return (
    <div className="min-h-dvh bg-bg-page text-primary-text">
      <header className="px-8 py-5 border-b border-white/[0.06]">
        <Link href="/" className="inline-flex items-center gap-2.5">
          <PicsmithMark size={20} className="text-white" />
          <span className="font-display text-lg font-extrabold tracking-tighter brand-gradient-text">Picsmith</span>
        </Link>
      </header>
      <main className="max-w-2xl mx-auto px-6 py-12 prose-sm">
        {children}
      </main>
      <footer className="max-w-2xl mx-auto px-6 pb-12 flex gap-6 micro-label">
        <Link href="/legal/terms" className="hover:text-white transition-colors">服务条款</Link>
        <Link href="/legal/privacy" className="hover:text-white transition-colors">隐私政策</Link>
        <Link href="/legal/refund" className="hover:text-white transition-colors">退款政策</Link>
        <Link href="/" className="hover:text-white transition-colors">返回首页</Link>
      </footer>
    </div>
  );
}
