"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useApi } from "@/context/ApiContext";
import { PicsmithMark } from "@/components/Logo";

const Navbar = () => {
  const { userData, loading } = useApi();
  const [mounted, setMounted] = useState(false);

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
            <span className="micro-label hidden sm:inline">图匠 // E-COM · LOGO · SOCIAL</span>
          </Link>
        </div>

        <div className="flex items-center gap-4 justify-end">
          {mounted && !loading && userData && (
            <div className="flex items-center gap-3">
              <span className="px-3 py-1.5 text-[10px] font-mono font-bold tracking-[0.15em] uppercase border border-white/10 rounded-sm bg-white/5 text-gray-400">
                CREDITS&nbsp;<span className="text-white">{userData.balance ?? 0}</span>
              </span>
              <span className="text-[11px] font-mono font-bold uppercase tracking-[0.15em] text-gray-500 hidden sm:block">
                {userData.username || "User"}
              </span>
            </div>
          )}
        </div>
      </header>
      {/* fixed header 占位 */}
      <div className="h-[57px]" />
    </div>
  );
};

export default Navbar;
