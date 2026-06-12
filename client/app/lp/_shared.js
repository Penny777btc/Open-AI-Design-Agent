"use client";

import Link from "next/link";
import { PicsmithMark } from "@/components/Logo";

/* 三个设计稿共用的清单与外壳 */

export const CASES = [
  { f: "ec-thermos-scene.png", label: "户外场景主图", scene: "电商", brief: "白底主图一句话改成露营场景，产品完全一致", w: 1536, h: 1024 },
  { f: "ec-promo-poster.png", label: "大促海报", scene: "电商", brief: "年中大促 · 中文文字精准渲染", w: 1024, h: 1536 },
  { f: "poster-vintage.png", label: "品牌海报", scene: "电商", brief: "复古手冲咖啡店宣传海报", w: 1024, h: 1536 },
  { f: "social-rednote.png", label: "小红书封面", scene: "自媒体", brief: "7 天收纳改造 · 治愈系大字封面", w: 1024, h: 1536 },
  { f: "ec-thermos-hero.png", label: "白底主图", scene: "电商", brief: "直接可上架的电商标准主图", w: 1024, h: 1024 },
  { f: "logo-badge.png", label: "徽章 Logo", scene: "Logo", brief: "复古徽章方向 · 一次出 3 方案", w: 1024, h: 1024 },
  { f: "social-youtube.png", label: "视频缩略图", scene: "自媒体", brief: "高点击率构图 · 文字渲染", w: 1536, h: 1024 },
  { f: "ec-skincare-scene.png", label: "场景化主图", scene: "电商", brief: "氛围种草 · 晨光实拍质感", w: 1024, h: 1024 },
  { f: "poster-night.png", label: "夜间版海报", scene: "改图", brief: "一句话改色调 · 文字构图不变", w: 1024, h: 1536 },
  { f: "logo-minimal.png", label: "极简 Logo", scene: "Logo", brief: "极简线条方向", w: 1024, h: 1024 },
  { f: "social-podcast.png", label: "播客封面", scene: "自媒体", brief: "Art Deco 复古风", w: 1024, h: 1024 },
  { f: "ec-banner-coffee.png", label: "详情 Banner", scene: "电商", brief: "16:9 详情页头图", w: 1536, h: 1024 },
  { f: "logo-wordmark.png", label: "字标 Logo", scene: "Logo", brief: "几何字标方向", w: 1024, h: 1024 },
  { f: "poster-badge.png", label: "徽章海报", scene: "电商", brief: "同 brief 第二方案", w: 1024, h: 1536 },
];

export function LpShell({ variant, title, children }) {
  return (
    <div className="min-h-dvh bg-bg-page text-primary-text">
      <header className="fixed top-0 left-0 right-0 z-[100] flex items-center justify-between px-6 sm:px-10 py-4 bg-[#09090b]/90 backdrop-blur-xl border-b border-white/[0.06]">
        <span className="flex items-center gap-2.5">
          <PicsmithMark size={22} className="text-white" />
          <span className="font-display text-xl font-extrabold tracking-tighter brand-gradient-text">Picsmith</span>
          <span className="micro-label hidden md:inline">案例区设计稿 {variant}</span>
        </span>
        <nav className="flex items-center gap-3 micro-label">
          <Link href="/lp/v1" className="hover:text-white transition-colors">V1 瀑布墙</Link>
          <Link href="/lp/v2" className="hover:text-white transition-colors">V2 BENTO</Link>
          <Link href="/lp/v3" className="hover:text-white transition-colors">V3 沉浸滚动</Link>
          <Link href="/" className="px-3 py-1.5 border border-white/15 rounded-sm hover:text-white hover:border-white/30 transition-all">返回现版</Link>
        </nav>
      </header>
      <div className="pt-[57px]">
        <div className="text-center pt-14 pb-10 px-6 flex flex-col gap-3">
          <div className="micro-label">// SHOWCASE REDESIGN · {variant}</div>
          <h1 className="font-display text-3xl sm:text-5xl font-extrabold tracking-tight">{title}</h1>
        </div>
        {children}
      </div>
    </div>
  );
}
