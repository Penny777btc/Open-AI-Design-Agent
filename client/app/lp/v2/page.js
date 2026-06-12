"use client";

/* V2 — Bento 拼图（Linear / Apple 发布会风格）
   不对称大小格，主案例占巨幅，节奏感强，信息密度与气场兼得。 */

import { CASES, LpShell } from "../_shared";

const byFile = Object.fromEntries(CASES.map((c) => [c.f, c]));

/* [文件名, col-span, row-span] —— 4 列网格上的拼图编排 */
const LAYOUT = [
  ["ec-thermos-scene.png", 2, 2],
  ["ec-promo-poster.png", 1, 3],
  ["social-rednote.png", 1, 3],
  ["social-youtube.png", 2, 2],
  ["logo-badge.png", 1, 1],
  ["logo-minimal.png", 1, 1],
  ["poster-vintage.png", 1, 3],
  ["ec-skincare-scene.png", 1, 2],
  ["ec-banner-coffee.png", 2, 1],
  ["poster-night.png", 1, 3],
  ["ec-thermos-hero.png", 1, 2],
  ["social-podcast.png", 1, 1],
  ["logo-wordmark.png", 1, 1],
  ["poster-badge.png", 1, 2],
];

export default function V2() {
  return (
    <LpShell variant="V2" title={<>一面<span className="brand-gradient-text">作品墙</span>，三个战场</>}>
      <div className="max-w-[1500px] mx-auto px-4 pb-24">
        <div className="grid grid-cols-2 md:grid-cols-4 auto-rows-[150px] md:auto-rows-[170px] gap-3 grid-flow-dense">
          {LAYOUT.map(([f, cs, rs]) => {
            const c = byFile[f];
            return (
              <figure
                key={f}
                style={{ gridColumn: `span ${cs}`, gridRow: `span ${rs}` }}
                className="group relative rounded-sm overflow-hidden border border-white/[0.07] hover:border-white/30 transition-all duration-500"
              >
                <img src={`/showcase/${f}`} alt={c.label} loading="lazy"
                  className="absolute inset-0 w-full h-full object-cover group-hover:scale-[1.04] transition-transform duration-700" />
                {/* 常驻角标 + 悬停简介 */}
                <div className="absolute top-2 left-2 px-2 py-1 bg-black/60 backdrop-blur-sm rounded-sm micro-label">
                  {c.scene}
                </div>
                <figcaption className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 to-transparent p-3 pt-8 translate-y-2 opacity-0 group-hover:translate-y-0 group-hover:opacity-100 transition-all duration-300">
                  <span className="text-white text-[13px] font-bold">{c.label}</span>
                  <span className="block text-gray-400 text-[10px] mt-0.5">{c.brief}</span>
                </figcaption>
              </figure>
            );
          })}
        </div>
      </div>
    </LpShell>
  );
}
