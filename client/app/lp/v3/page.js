"use client";

/* V3 — 沉浸式逐场景滚动（Runway / 苹果产品页风格）
   每个场景一屏：巨幅主案例做背景，左下大标题叙事，配套案例缩略条。 */

import { CASES, LpShell } from "../_shared";

const byFile = Object.fromEntries(CASES.map((c) => [c.f, c]));

const CHAPTERS = [
  {
    tag: "E-COMMERCE",
    title: "电商设计",
    headline: "从上架到大促，一套全包",
    desc: "白底主图、场景种草图、中文大促海报、详情 banner——按平台规格直接交付。",
    hero: "ec-thermos-scene.png",
    rest: ["ec-thermos-hero.png", "ec-promo-poster.png", "ec-skincare-scene.png", "ec-banner-coffee.png"],
  },
  {
    tag: "LOGO & BRAND",
    title: "Logo 设计",
    headline: "一个 brief，三个方向",
    desc: "极简标记、复古徽章、几何字标同时交付，对比着挑，不用反复沟通。",
    hero: "logo-badge.png",
    rest: ["logo-minimal.png", "logo-wordmark.png"],
  },
  {
    tag: "SOCIAL MEDIA",
    title: "自媒体配图",
    headline: "大字封面，点击率说话",
    desc: "小红书封面、视频缩略图、播客封面——中文标题渲染稳定，构图为点击率服务。",
    hero: "social-rednote.png",
    rest: ["social-youtube.png", "social-podcast.png", "poster-vintage.png"],
  },
];

export default function V3() {
  return (
    <LpShell variant="V3" title={<>三个战场，<span className="brand-gradient-text">逐屏沉浸</span></>}>
      <div className="flex flex-col">
        {CHAPTERS.map((ch, i) => (
          <section key={ch.tag} className="relative min-h-[92vh] flex items-end overflow-hidden border-t border-white/[0.06]">
            {/* 巨幅背景 */}
            <img src={`/showcase/${ch.hero}`} alt={ch.title}
              className="absolute inset-0 w-full h-full object-cover opacity-60" />
            <div className="absolute inset-0 bg-gradient-to-t from-[#09090b] via-[#09090b]/55 to-[#09090b]/10" />
            <div className="absolute inset-0 bg-gradient-to-r from-[#09090b]/70 to-transparent" />

            {/* 叙事层 */}
            <div className="relative max-w-6xl mx-auto w-full px-6 sm:px-12 pb-16 flex flex-col gap-5">
              <span className="micro-label">// {String(i + 1).padStart(2, "0")} · {ch.tag}</span>
              <h2 className="font-display text-4xl sm:text-7xl font-extrabold tracking-tight leading-none">
                {ch.title}
              </h2>
              <p className="text-lg sm:text-2xl text-white font-semibold">{ch.headline}</p>
              <p className="text-secondary-text max-w-xl">{ch.desc}</p>

              {/* 配套案例缩略条 */}
              <div className="flex gap-3 mt-3 overflow-x-auto scrollbar-subtle pb-1">
                {ch.rest.map((f) => (
                  <figure key={f} className="group shrink-0 w-36 sm:w-44">
                    <div className="rounded-sm overflow-hidden border border-white/15 hover:border-white/40 transition-all aspect-square">
                      <img src={`/showcase/${f}`} alt={byFile[f].label}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                    </div>
                    <figcaption className="micro-label mt-1.5">{byFile[f].label}</figcaption>
                  </figure>
                ))}
              </div>
            </div>
          </section>
        ))}
      </div>
      <div className="h-16" />
    </LpShell>
  );
}
